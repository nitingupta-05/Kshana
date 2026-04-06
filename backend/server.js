require("dotenv").config({ path: __dirname + "/.env" });

const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin: ALLOWED_ORIGINS.includes("*")
    ? "*"
    : ALLOWED_ORIGINS,
  methods: ["GET", "POST", "PATCH"],
};

const io = new Server(server, {
  cors: corsOptions,
});

const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret";
const onlineCounts = new Map(); // userId -> socket count

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Force Google DNS to bypass broken system DNS resolvers
const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB error:", err.message);
    process.exit(1);
  });

// ================= MODELS =================

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    description: { type: String, default: "" },
    profileImage: { type: String, default: "" },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

const makePairKey = (a, b) => {
  const [x, y] = [a.toString(), b.toString()].sort();
  return `${x}:${y}`;
};

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ],
    isGroup: { type: Boolean, default: false },
    title: { type: String, default: "" },
    pairKey: { type: String, unique: true, sparse: true },
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
  },
  { timestamps: true }
);
conversationSchema.index({ participants: 1, updatedAt: -1 });

const Conversation = mongoose.model("Conversation", conversationSchema);

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["text"], default: "text" },
    text: { type: String, default: "" },
    deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);
messageSchema.index({ conversation: 1, createdAt: -1 });

const Message = mongoose.model("Message", messageSchema);

const requestSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true }
);
requestSchema.index({ from: 1, to: 1 }, { unique: true });
requestSchema.index({ to: 1, status: 1, createdAt: -1 });

const Request = mongoose.model("Request", requestSchema);

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: {
      type: String,
      enum: ["request_received", "request_accepted", "message"],
      required: true,
    },
    data: { type: Object, default: {} },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);
notificationSchema.index({ user: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", notificationSchema);

const pushTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, default: "expo" },
  },
  { timestamps: true }
);
pushTokenSchema.index({ user: 1, token: 1 }, { unique: true });

const PushToken = mongoose.model("PushToken", pushTokenSchema);

// ================= AUTH MIDDLEWARE =================

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ msg: "No token provided" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    return res.status(401).json({ msg: "Invalid token" });
  }
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toPublicUser = (u) => {
  if (!u) return null;
  return {
    id: u._id,
    name: u.name,
    email: u.email,
    description: u.description ?? "",
    profileImage: u.profileImage ?? "",
  };
};

const ensureConversationAccess = async (conversationId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(conversationId)) return null;
  return await Conversation.findOne({ _id: conversationId, participants: userId });
};

const populateConversation = async (conversationId) => {
  return await Conversation.findById(conversationId)
    .populate("participants", "name email description profileImage")
    .populate({
      path: "lastMessage",
      select: "kind text createdAt sender",
      populate: { path: "sender", select: "name email profileImage" },
    });
};

const toPublicConversation = (c) => {
  if (!c) return null;
  return {
    id: c._id,
    participants: Array.isArray(c.participants)
      ? c.participants.map(toPublicUser)
      : [],
    isGroup: c.isGroup,
    title: c.title,
    lastMessage: c.lastMessage
      ? {
          id: c.lastMessage._id,
          kind: c.lastMessage.kind,
          text: c.lastMessage.text,
          createdAt: c.lastMessage.createdAt,
          sender: toPublicUser(c.lastMessage.sender),
        }
      : null,
    updatedAt: c.updatedAt,
    createdAt: c.createdAt,
  };
};

const toPublicMessage = (m) => {
  if (!m) return null;
  return {
    id: m._id,
    conversationId: String(m.conversation),
    sender: toPublicUser(m.sender),
    kind: m.kind,
    text: m.text,
    createdAt: m.createdAt,
    deliveredTo: (m.deliveredTo || []).map((id) => id.toString()),
    readBy: (m.readBy || []).map((id) => id.toString()),
  };
};

const toPublicRequest = (r) => {
  if (!r) return null;
  return {
    id: r._id,
    from: toPublicUser(r.from),
    to: toPublicUser(r.to),
    status: r.status,
    createdAt: r.createdAt,
  };
};

const toPublicNotification = (n) => {
  if (!n) return null;
  return {
    id: n._id,
    type: n.type,
    data: n.data ?? {},
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
};

const sendExpoPush = async (tokens, title, body, data) => {
  if (!tokens?.length) return;
  const messages = tokens.map((t) => ({
    to: t,
    sound: "default",
    title,
    body,
    data,
  }));
  const chunkSize = 100;
  for (let i = 0; i < messages.length; i += chunkSize) {
    const chunk = messages.slice(i, i + chunkSize);
    try {
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chunk),
      });
    } catch (err) {
      console.error("Push send error:", err);
    }
  }
};

// ================= ROUTES =================

app.get("/", (_, res) => {
  res.json({ status: "Server running" });
});

app.get("/healthz", (_, res) => {
  res.json({ ok: true });
});

// --- Auth
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, description } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ msg: "All fields required" });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ msg: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.create({
      name,
      email,
      password: hashedPassword,
      description,
    });

    res.json({ msg: "Registered successfully" });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "1d" });

    res.json({ msg: "Login successful", token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

app.post("/api/auth/logout", verifyToken, (req, res) => {
  res.json({ msg: "Logout successful" });
});

app.get("/api/auth/verify", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-password");
    if (!user) return res.status(404).json({ msg: "User not found" });

    res.json({
      valid: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        description: user.description,
        profileImage: user.profileImage,
      },
    });
  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// --- User
app.get("/api/user/profile", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-password");
    if (!user) return res.status(404).json({ msg: "User not found" });

    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      description: user.description,
      profileImage: user.profileImage,
    });
  } catch (err) {
    console.error("Profile error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

app.patch("/api/user/update", verifyToken, async (req, res) => {
  try {
    const { name, description, profileImage } = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      req.userId,
      { name, description, profileImage },
      { new: true }
    ).select("-password");

    res.json({ msg: "Profile updated", user: updatedUser });
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

app.get("/api/users", verifyToken, async (req, res) => {
  try {
    const search = (req.query.q || req.query.search || "").toString().trim();
    const query = { _id: { $ne: req.userId } };

    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      query.$or = [{ name: rx }, { email: rx }];
    }

    const users = await User.find(query)
      .select("name email description profileImage")
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      users: users.map(toPublicUser),
    });
  } catch (err) {
    console.error("List users error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// Presence
app.get("/api/presence/online", verifyToken, async (_req, res) => {
  const ids = [];
  for (const [id, count] of onlineCounts.entries()) {
    if (count > 0) ids.push(id);
  }
  res.json({ online: ids });
});

// Suggestions (simple: same email domain)
app.get("/api/suggestions", verifyToken, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select("email");
    const domain = me?.email?.split("@")?.[1];
    if (!domain) return res.json({ users: [] });

    const rx = new RegExp(`@${escapeRegex(domain)}$`, "i");
    const users = await User.find({ _id: { $ne: req.userId }, email: rx })
      .select("name email description profileImage")
      .sort({ createdAt: -1 })
      .limit(15);

    res.json({ users: users.map(toPublicUser) });
  } catch (err) {
    console.error("Suggestions error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// Requests (contact/message requests)
app.post("/api/requests", verifyToken, async (req, res) => {
  try {
    const toUserId = req.body.toUserId || req.body.userId;
    if (!toUserId) return res.status(400).json({ msg: "toUserId is required" });
    if (!mongoose.Types.ObjectId.isValid(toUserId)) {
      return res.status(400).json({ msg: "Invalid toUserId" });
    }
    if (toUserId.toString() === req.userId.toString()) {
      return res.status(400).json({ msg: "Cannot request yourself" });
    }

    const toUser = await User.findById(toUserId).select("_id");
    if (!toUser) return res.status(404).json({ msg: "User not found" });

    let requestDoc;
    try {
      requestDoc = await Request.create({ from: req.userId, to: toUserId, status: "pending" });
    } catch (e) {
      if (e && e.code === 11000) {
        requestDoc = await Request.findOne({ from: req.userId, to: toUserId });
      } else {
        throw e;
      }
    }

    const populated = await Request.findById(requestDoc._id)
      .populate("from", "name email description profileImage")
      .populate("to", "name email description profileImage");

    const notification = await Notification.create({
      user: toUserId,
      type: "request_received",
      data: { requestId: requestDoc._id, from: toPublicUser(populated.from) },
    });

    const unreadCount = await Notification.countDocuments({ user: toUserId, readAt: null, type: { $ne: "message" } });
    io.to(`user:${toUserId}`).emit("notify:new", {
      notification: toPublicNotification(notification),
      unreadCount,
    });

    res.status(201).json({ request: toPublicRequest(populated) });
  } catch (err) {
    console.error("Create request error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

app.get("/api/requests/incoming", verifyToken, async (req, res) => {
  try {
    const requests = await Request.find({ to: req.userId, status: "pending" })
      .sort({ createdAt: -1 })
      .populate("from", "name email description profileImage")
      .populate("to", "name email description profileImage");

    res.json({ requests: requests.map(toPublicRequest) });
  } catch (err) {
    console.error("Incoming requests error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

app.get("/api/requests/sent", verifyToken, async (req, res) => {
  try {
    const requests = await Request.find({ from: req.userId })
      .select("to status")
      .lean();
    // Return map of toUserId -> status for quick lookup
    const map = {};
    requests.forEach((r) => { map[r.to.toString()] = r.status; });
    res.json({ map });
  } catch (err) {
    console.error("Sent requests error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

app.post("/api/requests/:id/accept", verifyToken, async (req, res) => {
  try {
    const requestDoc = await Request.findById(req.params.id);
    if (!requestDoc) return res.status(404).json({ msg: "Request not found" });
    if (requestDoc.to.toString() !== req.userId.toString()) {
      return res.status(403).json({ msg: "Not allowed" });
    }
    if (requestDoc.status !== "pending") {
      return res.json({ request: { id: requestDoc._id, status: requestDoc.status } });
    }

    requestDoc.status = "accepted";
    await requestDoc.save();

    const fromUserId = requestDoc.from.toString();
    const meUser = await User.findById(req.userId).select("name email description profileImage");

    const notification = await Notification.create({
      user: fromUserId,
      type: "request_accepted",
      data: { requestId: requestDoc._id, by: toPublicUser(meUser) },
    });

    const unreadCount = await Notification.countDocuments({ user: fromUserId, readAt: null, type: { $ne: "message" } });
    io.to(`user:${fromUserId}`).emit("notify:new", {
      notification: toPublicNotification(notification),
      unreadCount,
    });

    const populated = await Request.findById(requestDoc._id)
      .populate("from", "name email description profileImage")
      .populate("to", "name email description profileImage");

    res.json({ request: toPublicRequest(populated) });
  } catch (err) {
    console.error("Accept request error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

app.post("/api/requests/:id/reject", verifyToken, async (req, res) => {
  try {
    const requestDoc = await Request.findById(req.params.id);
    if (!requestDoc) return res.status(404).json({ msg: "Request not found" });
    if (requestDoc.to.toString() !== req.userId.toString()) {
      return res.status(403).json({ msg: "Not allowed" });
    }
    requestDoc.status = "rejected";
    await requestDoc.save();
    res.json({ request: { id: requestDoc._id, status: requestDoc.status } });
  } catch (err) {
    console.error("Reject request error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// Notifications
app.get("/api/notifications/unread-count", verifyToken, async (req, res) => {
  const count = await Notification.countDocuments({ user: req.userId, readAt: null, type: { $ne: "message" } });
  res.json({ count });
});

app.get("/api/notifications", verifyToken, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "50", 10) || 50, 200));
    const unreadOnly = String(req.query.unread || "") === "1";
    const filter = { user: req.userId, type: { $ne: "message" } };
    if (unreadOnly) filter.readAt = null;

    const notifications = await Notification.find(filter).sort({ createdAt: -1 }).limit(limit);
    res.json({ notifications: notifications.map(toPublicNotification) });
  } catch (err) {
    console.error("List notifications error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

app.post("/api/notifications/:id/read", verifyToken, async (req, res) => {
  try {
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { readAt: new Date() },
      { new: true }
    );
    if (!n) return res.status(404).json({ msg: "Not found" });
    res.json({ notification: toPublicNotification(n) });
  } catch (err) {
    console.error("Read notification error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

app.post("/api/notifications/read-all", verifyToken, async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.userId, readAt: null },
      { $set: { readAt: new Date() } }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Read all notifications error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// Conversation unread counts (from message notifications)
app.get("/api/conversations/unread-counts", verifyToken, async (req, res) => {
  try {
    const rows = await Notification.aggregate([
      {
        $match: {
          user: new mongoose.Types.ObjectId(req.userId),
          type: "message",
          readAt: null,
          "data.conversationId": { $exists: true },
        },
      },
      { $group: { _id: "$data.conversationId", count: { $sum: 1 } } },
    ]);

    const counts = {};
    rows.forEach((r) => {
      if (r?._id) counts[String(r._id)] = r.count;
    });

    res.json({ counts });
  } catch (err) {
    console.error("Unread counts error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// Mark conversation messages as read
app.post("/api/conversations/:id/read", verifyToken, async (req, res) => {
  try {
    const conversation = await ensureConversationAccess(req.params.id, req.userId);
    if (!conversation) return res.status(404).json({ msg: "Conversation not found" });

    await Message.updateMany(
      { conversation: conversation._id, readBy: { $ne: req.userId } },
      { $addToSet: { readBy: req.userId } }
    );

    await Notification.updateMany(
      {
        user: req.userId,
        type: "message",
        readAt: null,
        "data.conversationId": conversation._id,
      },
      { $set: { readAt: new Date() } }
    );

    io.to(`conversation:${conversation._id}`).emit("message:status", {
      conversationId: String(conversation._id),
      userId: String(req.userId),
      status: "read",
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Conversation read error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// Push token registration
app.post("/api/push/register", verifyToken, async (req, res) => {
  try {
    const token = (req.body.token || "").toString().trim();
    const platform = (req.body.platform || "expo").toString();
    if (!token) return res.status(400).json({ msg: "token is required" });

    await PushToken.updateOne(
      { token },
      { $set: { user: req.userId, token, platform } },
      { upsert: true }
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("Push register error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// --- Chat
app.post("/api/conversations", verifyToken, async (req, res) => {
  try {
    const participantId = req.body.participantId || req.body.userId;
    if (!participantId) return res.status(400).json({ msg: "participantId is required" });
    if (!mongoose.Types.ObjectId.isValid(participantId)) {
      return res.status(400).json({ msg: "Invalid participantId" });
    }
    if (participantId.toString() === req.userId.toString()) {
      return res.status(400).json({ msg: "Cannot start chat with yourself" });
    }

    const other = await User.findById(participantId).select("_id");
    if (!other) return res.status(404).json({ msg: "User not found" });

    const pairKey = makePairKey(req.userId, participantId);
    let conversation = await Conversation.findOne({ pairKey });

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [req.userId, participantId],
        pairKey,
      });
    }

    const populated = await populateConversation(conversation._id);
    res.status(201).json({
      conversation: toPublicConversation(populated),
    });
  } catch (err) {
    if (err && err.code === 11000) {
      try {
        const participantId = req.body.participantId || req.body.userId;
        const pairKey = makePairKey(req.userId, participantId);
        const conversation = await Conversation.findOne({ pairKey });
        const populated = await populateConversation(conversation._id);
        return res.status(200).json({
          conversation: toPublicConversation(populated),
        });
      } catch (e) {
        console.error("Conversation recovery error:", e);
      }
    }

    console.error("Create conversation error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

app.get("/api/conversations", verifyToken, async (req, res) => {
  try {
    const conversations = await Conversation.find({ participants: req.userId })
      .sort({ updatedAt: -1 })
      .populate("participants", "name email description profileImage")
      .populate({
        path: "lastMessage",
        select: "kind text createdAt sender",
        populate: { path: "sender", select: "name email profileImage" },
      });

    res.json({
      conversations: conversations.map(toPublicConversation),
    });
  } catch (err) {
    console.error("List conversations error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

app.get("/api/conversations/:id", verifyToken, async (req, res) => {
  try {
    const conversation = await ensureConversationAccess(req.params.id, req.userId);
    if (!conversation) return res.status(404).json({ msg: "Conversation not found" });

    const populated = await populateConversation(conversation._id);
    res.json({
      conversation: toPublicConversation(populated),
    });
  } catch (err) {
    console.error("Get conversation error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

app.get("/api/conversations/:id/messages", verifyToken, async (req, res) => {
  try {
    const conversation = await ensureConversationAccess(req.params.id, req.userId);
    if (!conversation) return res.status(404).json({ msg: "Conversation not found" });

    const limit = Math.max(
      1,
      Math.min(parseInt(req.query.limit || "50", 10) || 50, 200)
    );

    const messages = await Message.find({ conversation: conversation._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("sender", "name email profileImage");

    messages.reverse();

    res.json({
      messages: messages.map(toPublicMessage),
    });
  } catch (err) {
    console.error("List messages error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

app.post("/api/conversations/:id/messages", verifyToken, async (req, res) => {
  try {
    const conversation = await ensureConversationAccess(req.params.id, req.userId);
    if (!conversation) return res.status(404).json({ msg: "Conversation not found" });

    const text = (req.body.text || "").toString();
    if (!text.trim()) return res.status(400).json({ msg: "Message text is required" });

    const recipients = conversation.participants
      .map((p) => p.toString())
      .filter((id) => id !== req.userId.toString());
    const deliveredTo = [
      req.userId,
      ...recipients.filter((id) => (onlineCounts.get(id) || 0) > 0),
    ];

    const msg = await Message.create({
      conversation: conversation._id,
      sender: req.userId,
      kind: "text",
      text: text.trim(),
      deliveredTo,
      readBy: [req.userId],
    });

    conversation.lastMessage = msg._id;
    await conversation.save();

    const populated = await Message.findById(msg._id).populate(
      "sender",
      "name email profileImage"
    );

    const wireMessage = toPublicMessage(populated);

    io.to(`conversation:${conversation._id}`).emit("message:new", {
      message: wireMessage,
    });

    const senderUser = await User.findById(req.userId).select(
      "name email description profileImage"
    );

    for (const recipientId of recipients) {
      const notification = await Notification.create({
        user: recipientId,
        type: "message",
        data: {
          conversationId: String(conversation._id),
          text: wireMessage.text,
          from: toPublicUser(senderUser),
        },
      });

      const unreadCount = await Notification.countDocuments({
        user: recipientId,
        readAt: null,
      });

      io.to(`user:${recipientId}`).emit("notify:new", {
        notification: toPublicNotification(notification),
        unreadCount,
      });

      if ((onlineCounts.get(recipientId) || 0) === 0) {
        const pushTokens = await PushToken.find({ user: recipientId }).select("token");
        const tokens = pushTokens.map((t) => t.token);
        await sendExpoPush(
          tokens,
          senderUser?.name || "New message",
          wireMessage.text || "New message",
          { conversationId: String(conversation._id) }
        );
      }
    }

    res.status(201).json({ message: wireMessage });
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// ================= SOCKET.IO =================

io.use((socket, next) => {
  const token =
    socket.handshake.auth?.token ||
    socket.handshake.headers?.authorization?.split(" ")[1] ||
    socket.handshake.query?.token;

  if (!token) return next(new Error("unauthorized"));

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch {
    next(new Error("unauthorized"));
  }
});

io.on("connection", (socket) => {
  socket.join(`user:${socket.userId}`);
  const current = onlineCounts.get(socket.userId) || 0;
  onlineCounts.set(socket.userId, current + 1);
  io.emit("user:online", { userId: socket.userId });

  socket.on("conversation:join", async (payload, cb) => {
    try {
      const conversationId = payload?.conversationId;
      const conversation = await ensureConversationAccess(conversationId, socket.userId);
      if (!conversation) return cb?.({ ok: false, error: "Conversation not found" });

      socket.join(`conversation:${conversation._id}`);
      await Message.updateMany(
        { conversation: conversation._id, deliveredTo: { $ne: socket.userId } },
        { $addToSet: { deliveredTo: socket.userId } }
      );
      io.to(`conversation:${conversation._id}`).emit("message:status", {
        conversationId: String(conversation._id),
        userId: String(socket.userId),
        status: "delivered",
      });
      cb?.({ ok: true });
    } catch {
      cb?.({ ok: false, error: "Server error" });
    }
  });

  socket.on("message:send", async (payload, cb) => {
    try {
      const conversationId = payload?.conversationId;
      const text = (payload?.text || "").toString();
      if (!text.trim()) return cb?.({ ok: false, error: "Message text is required" });

      const conversation = await ensureConversationAccess(conversationId, socket.userId);
      if (!conversation) return cb?.({ ok: false, error: "Conversation not found" });

      const recipients = conversation.participants
        .map((p) => p.toString())
        .filter((id) => id !== socket.userId.toString());
      const deliveredTo = [
        socket.userId,
        ...recipients.filter((id) => (onlineCounts.get(id) || 0) > 0),
      ];

      const msg = await Message.create({
        conversation: conversation._id,
        sender: socket.userId,
        kind: "text",
        text: text.trim(),
        deliveredTo,
        readBy: [socket.userId],
      });

      conversation.lastMessage = msg._id;
      await conversation.save();

      const populated = await Message.findById(msg._id).populate(
        "sender",
        "name email profileImage"
      );

      const wireMessage = toPublicMessage(populated);

      io.to(`conversation:${conversation._id}`).emit("message:new", {
        message: wireMessage,
      });
      io.to(`conversation:${conversation._id}`).emit("message:status", {
        conversationId: String(conversation._id),
        userId: String(socket.userId),
        status: "sent",
      });

      const senderUser = await User.findById(socket.userId).select(
        "name email description profileImage"
      );

      for (const recipientId of recipients) {
        const notification = await Notification.create({
          user: recipientId,
          type: "message",
          data: {
            conversationId: String(conversation._id),
            text: wireMessage.text,
            from: toPublicUser(senderUser),
          },
        });

        const unreadCount = await Notification.countDocuments({
          user: recipientId,
          readAt: null,
        });

        io.to(`user:${recipientId}`).emit("notify:new", {
          notification: toPublicNotification(notification),
          unreadCount,
        });

        if ((onlineCounts.get(recipientId) || 0) === 0) {
          const pushTokens = await PushToken.find({ user: recipientId }).select("token");
          const tokens = pushTokens.map((t) => t.token);
          await sendExpoPush(
            tokens,
            senderUser?.name || "New message",
            wireMessage.text || "New message",
            { conversationId: String(conversation._id) }
          );
        }
      }

      cb?.({ ok: true, message: wireMessage });
    } catch (err) {
      console.error("Socket send message error:", err);
      cb?.({ ok: false, error: "Server error" });
    }
  });

  socket.on("typing:start", async (payload) => {
    const conversationId = payload?.conversationId;
    const conversation = await ensureConversationAccess(conversationId, socket.userId);
    if (!conversation) return;
    socket.to(`conversation:${conversation._id}`).emit("typing", {
      conversationId: String(conversation._id),
      userId: String(socket.userId),
      typing: true,
    });
  });

  socket.on("typing:stop", async (payload) => {
    const conversationId = payload?.conversationId;
    const conversation = await ensureConversationAccess(conversationId, socket.userId);
    if (!conversation) return;
    socket.to(`conversation:${conversation._id}`).emit("typing", {
      conversationId: String(conversation._id),
      userId: String(socket.userId),
      typing: false,
    });
  });

  socket.on("disconnect", () => {
    const current = onlineCounts.get(socket.userId) || 0;
    const next = Math.max(0, current - 1);
    if (next === 0) {
      onlineCounts.delete(socket.userId);
      io.emit("user:offline", { userId: socket.userId });
    } else {
      onlineCounts.set(socket.userId, next);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);

  // Keep-alive ping — prevents Render free tier cold starts
  // Pings /healthz every 14 minutes so the server never sleeps
  if (process.env.RENDER_EXTERNAL_URL) {
    const url = `${process.env.RENDER_EXTERNAL_URL}/healthz`;
    setInterval(async () => {
      try {
        await fetch(url);
        console.log("Keep-alive ping sent");
      } catch (e) {
        console.error("Keep-alive ping failed:", e.message);
      }
    }, 14 * 60 * 1000); // every 14 minutes
  }
});
