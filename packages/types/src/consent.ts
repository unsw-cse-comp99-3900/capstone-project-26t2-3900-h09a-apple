export type ConsentType = 'recording' | 'walkthrough';

export type ConsentStatusResponse = {
  accepted: boolean;
  accepted_at: string | null;
  consent_type: ConsentType;
  version: string;
};

export type ConsentAcceptRequest = {
  consent_type: ConsentType;
  version: string;
};

export type ConsentAcceptResponse = {
  consent_type: ConsentType;
  version: string;
  accepted_at: string;
};
