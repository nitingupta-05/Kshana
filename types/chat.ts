export type PublicUser = {
  id: string;
  name: string;
  email: string;
  description?: string;
  profileImage?: string;
  mood?: string;
};

export type Reaction = {
  emoji: string;
  userId: string;
  userName: string;
};

export type PublicMessage = {
  id: string;
  conversationId: string;
  sender: PublicUser;
  kind: 'text';
  text: string;
  createdAt: string;
  expiresAt?: string | null;
  deliveredTo: string[];
  readBy: string[];
  reactions: Reaction[];
  replyTo?: {
    id: string;
    text: string;
    senderName: string;
  } | null;
};

export type PublicConversation = {
  id: string;
  participants: PublicUser[];
  isGroup: boolean;
  title: string;
  lastMessage: null | {
    id: string;
    kind: 'text';
    text: string;
    createdAt: string;
    sender: PublicUser;
  };
  updatedAt: string;
  createdAt: string;
  disappearAfter: number; // seconds; 0 = off
};

export type Story = {
  id: string;
  author: PublicUser;
  text: string;
  image?: string;
  bgColor: string;
  createdAt: string;
  expiresAt: string;
  viewedBy: string[];
};

// Chat theme stored per-conversation in AsyncStorage
export type ChatTheme = {
  myBubble: string;
  theirBubble: string;
  myText: string;
  theirText: string;
};
