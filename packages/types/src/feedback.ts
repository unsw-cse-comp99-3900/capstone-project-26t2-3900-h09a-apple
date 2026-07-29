export type FeedbackClassification = 'friction' | 'question' | 'suggestion';
export type FeedbackPolarity = 'issue' | 'positive';
export type FeedbackSeverity = 'high' | 'medium' | 'low';
export type FeedbackReviewStatus = 'pending' | 'reviewed';

export type VoiceFeedbackCreateResponse = {
  feedback_id: string;
  transcript: string;
  classification: FeedbackClassification;
  polarity: FeedbackPolarity;
  severity: FeedbackSeverity;
  duration_seconds: number;
  language: string | null;
  status: FeedbackReviewStatus;
};

export type VoiceFeedbackItem = {
  id: string;
  sop_id: string;
  sop_title: string;
  employee_id: string;
  employee_email: string;
  transcript: string;
  classification: FeedbackClassification;
  polarity: FeedbackPolarity;
  severity: FeedbackSeverity;
  status: FeedbackReviewStatus;
  duration_seconds: number;
  language: string | null;
  reviewer_comment: string | null;
  reviewer_tags: string[];
  reviewed_by: string | null;
  reviewed_at: string | null;
  recorded_at: string;
  created_at: string;
  audio_url: string | null;
};

export type VoiceFeedbackListResponse = {
  feedbacks: VoiceFeedbackItem[];
};

export type VoiceFeedbackReviewRequest = {
  comment?: string | null;
  tags?: string[];
  mark_reviewed?: boolean;
};

export type FeedbackStatsResponse = {
  total: number;
  by_classification: Record<string, number>;
  by_severity: Record<string, number>;
  by_status: Record<string, number>;
  high_severity_open: VoiceFeedbackItem[];
};

export type FeedbackNotificationItem = {
  id: string;
  feedback_id: string;
  event_type: string;
  title: string;
  body: string;
  delivered_via: string;
  read_at: string | null;
  created_at: string;
  review_path: string;
};

export type FeedbackNotificationListResponse = {
  notifications: FeedbackNotificationItem[];
};

export type NotificationWsTicketResponse = {
  ticket: string;
  expires_in_seconds: number;
  ws_path: string;
};
