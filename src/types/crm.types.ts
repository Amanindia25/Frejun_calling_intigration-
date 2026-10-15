/**
 * Multi-Agent Creator & Multi-Candidate CRM Types
 */

export interface ICreator {
  id: string;
  name: string;
  email: string;
  phone: string; // E.164 phone number where this agent receives FreJun calls
  role?: string;
  isDefault?: boolean;
  createdAt: string;
}

export interface ICandidate {
  id: string;
  name: string;
  phone: string; // E.164 phone number of the lead/customer
  email?: string;
  company?: string;
  tags?: string[];
  notes?: string;
  lastCalledAt?: string | null;
  totalCalls: number;
  createdAt: string;
}

export interface CreateCreatorDto {
  name: string;
  email: string;
  phone: string;
  role?: string;
  isDefault?: boolean;
}

export interface CreateCandidateDto {
  name: string;
  phone: string;
  email?: string;
  company?: string;
  tags?: string[];
  notes?: string;
}
