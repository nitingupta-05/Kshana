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
const DB_STATE = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};
const onlineCounts = new Map(); // userId -> socket count

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
    mood: { type: String, default: "" }, // e.g. "🎯 Focused" or "🎮 Gaming"
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
    disappearAfter: { type: Number, default: 0 }, // seconds; 0 = off
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
    reactions: [
      {
        emoji: { type: String, required: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        userName: { type: String, default: "" },
      },
    ],
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    expiresAt: { type: Date, default: null, index: { expireAfterSeconds: 0 } },
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
      enum: ["request_received", "request_accepted", "message", "broadcast"],
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

// Story model — 24-hour disappearing posts
const storySchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, default: "" },
    image: { type: String, default: "" },
    bgColor: { type: String, default: "#7c3aed" },
    textColor: { type: String, default: "#ffffff" },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    viewedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

const Story = mongoose.model("Story", storySchema);

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
    mood: u.mood ?? "",
  };
};

const ensureConversationAccess = async (conversationId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(conversationId)) return null;
  return await Conversation.findOne({ _id: conversationId, participants: userId });
};

const populateConversation = async (conversationId) => {
  return await Conversation.findById(conversationId)
    .populate("participants", "name email description profileImage mood")
    .populate({
      path: "lastMessage",
      select: "kind text createdAt sender",
      populate: { path: "sender", select: "name email profileImage mood" },
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
    disappearAfter: c.disappearAfter ?? 0,
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
    reactions: (m.reactions || []).map((r) => ({
      emoji: r.emoji,
      userId: r.userId.toString(),
      userName: r.userName || "",
    })),
    replyTo: m.replyTo
      ? {
          id: m.replyTo._id ? m.replyTo._id.toString() : m.replyTo.toString(),
          text: m.replyTo.text || "",
          senderName: m.replyTo.sender?.name || "",
        }
      : null,
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

const toPublicStory = (s) => {
  if (!s) return null;
  return {
    id: s._id,
    author: toPublicUser(s.author),
    text: s.text || "",
    image: s.image || "",
    bgColor: s.bgColor || "#7c3aed",
    textColor: s.textColor || "#ffffff",
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    viewedBy: (s.viewedBy || []).map((id) => id.toString()),
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
  const state = mongoose.connection.readyState;
  const db = DB_STATE[state] || "unknown";
  const ok = state === 1;
  res.status(ok ? 200 : 503).json({ ok, db });
});

// Keep-alive ping — called by UptimeRobot every 5 min to prevent cold starts
app.get("/ping", (_, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Compatibility aliases for /api-level health checks
app.get("/api", (_, res) => {
  res.json({ ok: true, service: "kshana-backend" });
});

app.get("/api/healthz", (_, res) => {
  const state = mongoose.connection.readyState;
  const db = DB_STATE[state] || "unknown";
  const ok = state === 1;
  res.status(ok ? 200 : 503).json({ ok, db });
});

app.get("/api/ping", (_, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Warm-up endpoint for cold starts and proactive checks
app.get("/api/warmup", async (_, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ ok: false, db: DB_STATE[mongoose.connection.readyState] || "unknown" });
    }
    await mongoose.connection.db.admin().ping();
    return res.json({ ok: true, db: "connected", ts: Date.now() });
  } catch (err) {
    return res.status(503).json({ ok: false, error: err?.message || "warmup_failed" });
  }
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
        mood: user.mood ?? "",
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
      mood: user.mood ?? "",
    });
  } catch (err) {
    console.error("Profile error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

app.patch("/api/user/update", verifyToken, async (req, res) => {
  try {
    const { name, description, profileImage, mood } = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      req.userId,
      { name, description, profileImage, ...(mood !== undefined && { mood }) },
      { new: true }
    ).select("-password");

    // Broadcast mood change to all connected sockets
    if (mood !== undefined) {
      io.emit("user:mood", { userId: String(req.userId), mood: mood ?? "" });
    }

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
      .select("name email description profileImage mood")
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
      .select("name email description profileImage mood")
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
      .populate("from", "name email description profileImage mood")
      .populate("to", "name email description profileImage mood");

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
      .populate("from", "name email description profileImage mood")
      .populate("to", "name email description profileImage mood");

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
    const meUser = await User.findById(req.userId).select("name email description profileImage mood");

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
      .populate("from", "name email description profileImage mood")
      .populate("to", "name email description profileImage mood");

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
  const count = await Notification.countDocuments({ user: req.userId, readAt: null, type: { $in: ["request_received", "request_accepted", "broadcast"] } });
  res.json({ count });
});

app.get("/api/notifications", verifyToken, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "50", 10) || 50, 200));
    const unreadOnly = String(req.query.unread || "") === "1";
    const filter = { user: req.userId, type: { $in: ["request_received", "request_accepted", "broadcast"] } };
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
        "data.conversationId": String(conversation._id),
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

// Set disappearing messages timer for a conversation
app.patch("/api/conversations/:id/disappear", verifyToken, async (req, res) => {
  try {
    const conversation = await ensureConversationAccess(req.params.id, req.userId);
    if (!conversation) return res.status(404).json({ msg: "Conversation not found" });
    const seconds = Number(req.body.seconds) || 0;
    conversation.disappearAfter = seconds;
    await conversation.save();
    // Notify all participants
    io.to(`conversation:${conversation._id}`).emit("conversation:disappear", {
      conversationId: String(conversation._id),
      disappearAfter: seconds,
    });
    res.json({ ok: true, disappearAfter: seconds });
  } catch (err) {
    console.error("Disappear error:", err);
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

// ─── Reactions ────────────────────────────────────────────────────────────────

app.post("/api/messages/:id/react", verifyToken, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ msg: "emoji required" });

    const msg = await Message.findById(req.params.id).populate("conversation");
    if (!msg) return res.status(404).json({ msg: "Message not found" });

    // Verify user is a participant
    const conv = await ensureConversationAccess(msg.conversation._id, req.userId);
    if (!conv) return res.status(403).json({ msg: "Not allowed" });

    const me = await User.findById(req.userId).select("name");

    // Toggle: remove if same emoji already exists from this user, else upsert
    const existing = msg.reactions.find(
      (r) => r.userId.toString() === req.userId.toString() && r.emoji === emoji
    );
    if (existing) {
      msg.reactions = msg.reactions.filter(
        (r) => !(r.userId.toString() === req.userId.toString() && r.emoji === emoji)
      );
    } else {
      // Remove any other emoji from this user first (one reaction per user)
      msg.reactions = msg.reactions.filter(
        (r) => r.userId.toString() !== req.userId.toString()
      );
      msg.reactions.push({ emoji, userId: req.userId, userName: me?.name || "" });
    }
    await msg.save();

    const reactions = msg.reactions.map((r) => ({
      emoji: r.emoji,
      userId: r.userId.toString(),
      userName: r.userName,
    }));

    io.to(`conversation:${msg.conversation._id}`).emit("message:reaction", {
      messageId: msg._id.toString(),
      conversationId: msg.conversation._id.toString(),
      reactions,
    });

    res.json({ reactions });
  } catch (err) {
    console.error("React error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// ─── Stories ─────────────────────────────────────────────────────────────────

// Get active stories from contacts
app.get("/api/stories", verifyToken, async (req, res) => {
  try {
    const now = new Date();
    // Get accepted contacts
    const accepted = await Request.find({
      $or: [{ from: req.userId, status: "accepted" }, { to: req.userId, status: "accepted" }],
    }).select("from to");
    const contactIds = accepted.map((r) =>
      r.from.toString() === req.userId.toString() ? r.to : r.from
    );
    contactIds.push(req.userId); // include own stories

    const stories = await Story.find({
      author: { $in: contactIds },
      expiresAt: { $gt: now },
    })
      .sort({ createdAt: -1 })
      .populate("author", "name email profileImage mood");

    res.json({ stories: stories.map(toPublicStory) });
  } catch (err) {
    console.error("Get stories error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// Post a new story
app.post("/api/stories", verifyToken, async (req, res) => {
  try {
    const { text, image, bgColor, textColor } = req.body;
    if (!text && !image) return res.status(400).json({ msg: "text or image required" });

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const story = await Story.create({
      author: req.userId,
      text: text || "",
      image: image || "",
      bgColor: bgColor || "#7c3aed",
      textColor: textColor || "#ffffff",
      expiresAt,
    });

    const populated = await Story.findById(story._id).populate("author", "name email profileImage mood");
    const pub = toPublicStory(populated);

    // Notify contacts via socket
    io.emit("story:new", { story: pub });

    res.status(201).json({ story: pub });
  } catch (err) {
    console.error("Post story error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// Mark story as viewed
app.post("/api/stories/:id/view", verifyToken, async (req, res) => {
  try {
    await Story.findByIdAndUpdate(req.params.id, {
      $addToSet: { viewedBy: req.userId },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

// Get viewers of a story (only author can see full list)
app.get("/api/stories/:id/viewers", verifyToken, async (req, res) => {
  try {
    const story = await Story.findById(req.params.id).populate("viewedBy", "name email profileImage mood");
    if (!story) return res.status(404).json({ msg: "Story not found" });
    if (story.author.toString() !== req.userId.toString()) {
      return res.status(403).json({ msg: "Not allowed" });
    }
    res.json({
      count: story.viewedBy.length,
      viewers: story.viewedBy.map(toPublicUser),
    });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

// Get IDs of users who have active stories (for story rings)
app.get("/api/stories/active-authors", verifyToken, async (req, res) => {
  try {
    const now = new Date();
    const accepted = await Request.find({
      $or: [{ from: req.userId, status: "accepted" }, { to: req.userId, status: "accepted" }],
    }).select("from to");
    const contactIds = accepted.map((r) =>
      r.from.toString() === req.userId.toString() ? r.to : r.from
    );
    contactIds.push(req.userId);

    const authors = await Story.distinct("author", {
      author: { $in: contactIds },
      expiresAt: { $gt: now },
    });
    res.json({ authorIds: authors.map((id) => id.toString()) });
  } catch (err) {
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
      .populate("participants", "name email description profileImage mood")
      .populate({
        path: "lastMessage",
        select: "kind text createdAt sender",
        populate: { path: "sender", select: "name email profileImage mood" },
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
      .populate("sender", "name email profileImage mood")
      .populate({ path: "replyTo", select: "text sender", populate: { path: "sender", select: "name" } });

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

    const replyToId = req.body.replyTo || null;

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
      replyTo: replyToId && mongoose.Types.ObjectId.isValid(replyToId) ? replyToId : null,
      expiresAt: conversation.disappearAfter > 0
        ? new Date(Date.now() + conversation.disappearAfter * 1000)
        : null,
    });

    conversation.lastMessage = msg._id;
    await conversation.save();

    const populated = await Message.findById(msg._id)
      .populate("sender", "name email profileImage mood")
      .populate({ path: "replyTo", select: "text sender", populate: { path: "sender", select: "name" } });

    const wireMessage = toPublicMessage(populated);

    io.to(`conversation:${conversation._id}`).emit("message:new", {
      message: wireMessage,
    });

    const senderUser = await User.findById(req.userId).select(
      "name email description profileImage mood"
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

  // When user comes online, mark any pending messages as delivered
  // so sender tick state upgrades from single -> double in realtime.
  (async () => {
    try {
      const conversations = await Conversation.find({ participants: socket.userId }).select("_id");
      for (const convo of conversations) {
        const result = await Message.updateMany(
          {
            conversation: convo._id,
            sender: { $ne: socket.userId },
            deliveredTo: { $ne: socket.userId },
          },
          { $addToSet: { deliveredTo: socket.userId } }
        );
        const modified =
          typeof result.modifiedCount === "number"
            ? result.modifiedCount
            : (result.nModified || 0);
        if (modified > 0) {
          io.to(`conversation:${convo._id}`).emit("message:status", {
            conversationId: String(convo._id),
            userId: String(socket.userId),
            status: "delivered",
          });
        }
      }
    } catch (err) {
      console.error("Online delivery sync error:", err?.message || err);
    }
  })();

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

      const replyToId = payload?.replyTo || null;

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
        replyTo: replyToId && mongoose.Types.ObjectId.isValid(replyToId) ? replyToId : null,
        expiresAt: conversation.disappearAfter > 0
          ? new Date(Date.now() + conversation.disappearAfter * 1000)
          : null,
      });

      conversation.lastMessage = msg._id;
      await conversation.save();

      const populated = await Message.findById(msg._id)
        .populate("sender", "name email profileImage mood")
        .populate({ path: "replyTo", select: "text sender", populate: { path: "sender", select: "name" } });

      const wireMessage = toPublicMessage(populated);

      io.to(`conversation:${conversation._id}`).emit("message:new", {
        message: wireMessage,
      });
      // Only emit delivered status to recipients who are online — not "sent" to whole room
      for (const recipientId of recipients) {
        if ((onlineCounts.get(recipientId) || 0) > 0) {
          io.to(`user:${recipientId}`).emit("message:status", {
            conversationId: String(conversation._id),
            userId: String(recipientId),
            status: "delivered",
          });
        }
      }

      const senderUser = await User.findById(socket.userId).select(
        "name email description profileImage mood"
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

// ================= ADMIN ROUTES =================

const ADMIN_SECRET = process.env.ADMIN_SECRET || "kshana_admin_2024";

const verifyAdmin = (req, res, next) => {
  const secret = req.headers["x-admin-secret"];
  if (secret !== ADMIN_SECRET) return res.status(401).json({ msg: "Unauthorized" });
  next();
};

// Admin login
app.post("/admin/login", (req, res) => {
  const { secret } = req.body;
  if (secret !== ADMIN_SECRET) return res.status(401).json({ msg: "Invalid secret" });
  res.json({ ok: true, token: ADMIN_SECRET });
});

// Get all users
app.get("/admin/users", verifyAdmin, async (req, res) => {
  try {
    const users = await User.find().select("name email password description profileImage createdAt").sort({ createdAt: -1 });
    res.json({ users });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

// Get stats
app.get("/admin/stats", verifyAdmin, async (req, res) => {
  try {
    const [totalUsers, totalMessages, totalConversations] = await Promise.all([
      User.countDocuments(),
      Message.countDocuments(),
      Conversation.countDocuments(),
    ]);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const newToday = await User.countDocuments({ createdAt: { $gte: today } });
    res.json({ totalUsers, totalMessages, totalConversations, newToday });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

// Send broadcast notification to all users
app.post("/admin/broadcast", verifyAdmin, async (req, res) => {
  try {
    const { title, message } = req.body;
    if (!title || !message) return res.status(400).json({ msg: "title and message required" });

    const users = await User.find().select("_id");
    const notifDocs = users.map((u) => ({
      user: u._id,
      type: "broadcast",
      data: { title, message, by: { name: "Kshana Team" } },
    }));
    const inserted = await Notification.insertMany(notifDocs, { ordered: false });

    // Emit notify:new to each user's room so bell updates and notification page reloads
    for (let i = 0; i < users.length; i++) {
      const userId = users[i]._id.toString();
      const notif = inserted[i];
      if (!notif) continue;
      io.to(`user:${userId}`).emit("notify:new", {
        notification: {
          id: notif._id,
          type: "broadcast",
          data: { title, message, by: { name: "Kshana Team" } },
          readAt: null,
          createdAt: notif.createdAt,
        },
        unreadCount: 1,
      });
    }
    // Also emit global broadcast event
    io.emit("notify:broadcast", { title, message });
    console.log(`Broadcast sent: "${title}" to ${users.length} users`);

    res.json({ ok: true, sent: users.length });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

// Delete user
app.delete("/admin/users/:id", verifyAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);

  // Keep-alive ping — prevents Render free tier cold starts
  // Pings /api/warmup every 5 minutes to keep both server and DB connection active
  const renderUrl = process.env.RENDER_EXTERNAL_URL || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : null);
  
  if (renderUrl) {
    const url = `${renderUrl.replace(/\/+$/, "")}/api/warmup`;
    console.log(`Self-ping (warm-start) configured for: ${url}`);
    
    // Initial ping after 30s to ensure everything is ready
    setTimeout(() => {
      fetch(url).catch(e => console.error("Initial warm-up ping failed:", e.message));
    }, 30000);

    // Regular interval every 5 minutes
    setInterval(async () => {
      try {
        const start = Date.now();
        const res = await fetch(url);
        const duration = Date.now() - start;
        console.log(`[keep-alive] Ping sent to ${url}. Status: ${res.status} (${duration}ms)`);
      } catch (e) {
        console.error("[keep-alive] Ping failed:", e.message);
      }
    }, 5 * 60 * 1000); 
  } else {
    console.log("Self-ping skipped: RENDER_EXTERNAL_URL or RENDER_EXTERNAL_HOSTNAME not found.");
  }

});
