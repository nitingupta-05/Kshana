export type PublicUser = {
  id: string;
  name: string;
  email: string;
  description?: string;
  profileImage?: string;
};

export type PublicMessage = {
  id: string;
  conversationId: string;
  sender: PublicUser;
  kind: 'text';
  text: string;
  createdAt: string;
  deliveredTo: string[];
  readBy: string[];
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
};
