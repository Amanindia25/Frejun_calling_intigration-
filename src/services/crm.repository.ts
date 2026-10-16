import {
  ICreator,
  ICandidate,
  CreateCreatorDto,
  CreateCandidateDto,
} from "../types/crm.types";
import { normalizePhoneNumber } from "../utils/phone.utils";

export interface ICrmRepository {
  getCreators(): Promise<ICreator[]>;
  getCreatorById(id: string): Promise<ICreator | null>;
  getDefaultCreator(): Promise<ICreator | null>;
  addCreator(dto: CreateCreatorDto): Promise<ICreator>;
  deleteCreator(id: string): Promise<boolean>;
  setDefaultCreator(id: string): Promise<ICreator | null>;

  getCandidates(search?: string): Promise<ICandidate[]>;
  getCandidateById(id: string): Promise<ICandidate | null>;
  getCandidateByPhone(phone: string): Promise<ICandidate | null>;
  getCreatorByPhone(phone: string): Promise<ICreator | null>;
  addCandidate(dto: CreateCandidateDto): Promise<ICandidate>;
  deleteCandidate(id: string): Promise<boolean>;
  recordCallToCandidate(candidateIdOrPhone: string): Promise<void>;
}

export class InMemoryCrmRepository implements ICrmRepository {
  private creators: Map<string, ICreator> = new Map();
  private candidates: Map<string, ICandidate> = new Map();

  constructor() {
    this.seedInitialData();
  }

  private seedInitialData(): void {
    // 1. Calling Agents (Creators / Senders) - Exactly 2 (Aman, Ritu)
    const initialCreators: ICreator[] = [
      {
        id: "creator_aman",
        name: "Aman",
        email: "info@maxpinetechnology.com",
        phone: "+918376822509",
        role: "Calling Agent (Target: Aman Lead)",
        isDefault: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: "creator_ritu",
        name: "Ritu",
        email: "info@maxpinetechnology.com",
        phone: "+917903234057",
        role: "Calling Agent (Target: Ananya)",
        isDefault: false,
        createdAt: new Date().toISOString(),
      },
    ];

    for (const c of initialCreators) {
      this.creators.set(c.id, c);
    }

    // 2. Leads / Customers (Candidates / Receivers) - Exactly 2 (Aman Lead, Ananya)
    const initialCandidates: ICandidate[] = [
      {
        id: "cand_ayush",
        name: "Aman Lead",
        phone: "+918935926120",
        email: "amanlead@customer.com",
        company: "Lead (Paired with Aman)",
        tags: ["Paired with Aman", "Priority Lead"],
        notes: "When Aman calls, FreJun rings Aman (+918376822509) and bridges to Aman Lead.",
        totalCalls: 0,
        lastCalledAt: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: "cand_ananya",
        name: "Ananya",
        phone: "+918303831398",
        email: "ananya@customer.com",
        company: "Lead (Paired with Ritu)",
        tags: ["Paired with Ritu", "Enterprise"],
        notes: "When Ritu calls, FreJun rings Ritu (+917903234057) and bridges to Ananya.",
        totalCalls: 0,
        lastCalledAt: null,
        createdAt: new Date().toISOString(),
      },
    ];

    for (const cand of initialCandidates) {
      this.candidates.set(cand.id, cand);
    }
  }

  // --- Creator Operations ---

  public async getCreators(): Promise<ICreator[]> {
    return Array.from(this.creators.values()).sort((a, b) => {
      if (a.isDefault) return -1;
      if (b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  public async getCreatorById(id: string): Promise<ICreator | null> {
    return this.creators.get(id) || null;
  }

  public async getDefaultCreator(): Promise<ICreator | null> {
    const list = Array.from(this.creators.values());
    return list.find((c) => c.isDefault) || list[0] || null;
  }

  public async addCreator(dto: CreateCreatorDto): Promise<ICreator> {
    const id = `creator_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const phone = normalizePhoneNumber(dto.phone);

    // If marked default, unset existing default
    if (dto.isDefault) {
      for (const c of this.creators.values()) {
        c.isDefault = false;
      }
    }

    const creator: ICreator = {
      id,
      name: dto.name.trim(),
      email: dto.email.trim().toLowerCase(),
      phone,
      role: dto.role?.trim() || "Agent",
      isDefault: Boolean(dto.isDefault) || this.creators.size === 0,
      createdAt: new Date().toISOString(),
    };

    this.creators.set(id, creator);
    return creator;
  }

  public async deleteCreator(id: string): Promise<boolean> {
    return this.creators.delete(id);
  }

  public async setDefaultCreator(id: string): Promise<ICreator | null> {
    const creator = this.creators.get(id);
    if (!creator) return null;

    for (const c of this.creators.values()) {
      c.isDefault = c.id === id;
    }
    return creator;
  }

  // --- Candidate Operations ---

  public async getCandidates(search?: string): Promise<ICandidate[]> {
    const list = Array.from(this.candidates.values());
    if (!search || !search.trim()) {
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    const q = search.trim().toLowerCase();
    return list
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone.includes(q) ||
          (c.company && c.company.toLowerCase().includes(q)) ||
          (c.email && c.email.toLowerCase().includes(q)) ||
          (c.tags && c.tags.some((t) => t.toLowerCase().includes(q)))
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public async getCandidateById(id: string): Promise<ICandidate | null> {
    return this.candidates.get(id) || null;
  }

  public async getCandidateByPhone(phone: string): Promise<ICandidate | null> {
    if (!phone) return null;
    const norm = normalizePhoneNumber(phone);
    const clean = phone.replace(/\D/g, "").slice(-10);
    for (const c of this.candidates.values()) {
      if (normalizePhoneNumber(c.phone) === norm) {
        return c;
      }
      if (clean && c.phone.replace(/\D/g, "").slice(-10) === clean) {
        return c;
      }
    }
    return null;
  }

  public async getCreatorByPhone(phone: string): Promise<ICreator | null> {
    if (!phone) return null;
    const norm = normalizePhoneNumber(phone);
    const clean = phone.replace(/\D/g, "").slice(-10);
    for (const c of this.creators.values()) {
      if (normalizePhoneNumber(c.phone) === norm) {
        return c;
      }
      if (clean && c.phone.replace(/\D/g, "").slice(-10) === clean) {
        return c;
      }
    }
    return null;
  }

  public async addCandidate(dto: CreateCandidateDto): Promise<ICandidate> {
    const id = `cand_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const phone = normalizePhoneNumber(dto.phone);

    const candidate: ICandidate = {
      id,
      name: dto.name.trim(),
      phone,
      email: dto.email?.trim().toLowerCase(),
      company: dto.company?.trim(),
      tags: dto.tags || ["New Lead"],
      notes: dto.notes?.trim(),
      totalCalls: 0,
      lastCalledAt: null,
      createdAt: new Date().toISOString(),
    };

    this.candidates.set(id, candidate);
    return candidate;
  }

  public async deleteCandidate(id: string): Promise<boolean> {
    return this.candidates.delete(id);
  }

  public async recordCallToCandidate(candidateIdOrPhone: string): Promise<void> {
    let candidate: ICandidate | null = this.candidates.get(candidateIdOrPhone) || null;
    if (!candidate) {
      candidate = await this.getCandidateByPhone(candidateIdOrPhone);
    }

    if (candidate) {
      candidate.totalCalls = (candidate.totalCalls || 0) + 1;
      candidate.lastCalledAt = new Date().toISOString();
      this.candidates.set(candidate.id, candidate);
    }
  }
}
