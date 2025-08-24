import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface AccessToken {
  patientId: string; // Hex string for buff32
  owner: string;
  issuedTo: string;
  scopes: string[];
  expiry: number;
  terms: string;
  issuedAt: number;
  active: boolean;
}

interface AuditLogEntry {
  action: string;
  by: string;
  timestamp: number;
  notes: string;
}

interface TokenCounter {
  count: number;
}

interface PatientProfile {
  owner: string;
  registrationTimestamp: number;
  lastUpdated: number;
  metadata: string;
  verificationStatus: string;
  verifier: string | null;
  emergencyContacts: string[];
}

interface ContractState {
  accessTokens: Map<number, AccessToken>;
  tokenCounter: Map<string, TokenCounter>;
  accessAuditLog: Map<string, AuditLogEntry>; // Key: `${token-id}-${entry-id}`
  blockHeight: number;
  contractCaller: string;
}

// Mock PatientRegistry contract
class PatientRegistryMock {
  private profiles: Map<string, PatientProfile> = new Map();

  setProfile(patientId: string, profile: PatientProfile) {
    this.profiles.set(patientId, profile);
  }

  getPatientProfile(patientId: string): ClarityResponse<PatientProfile | null> {
    return { ok: true, value: this.profiles.get(patientId) ?? null };
  }

  isPatientVerified(patientId: string): ClarityResponse<boolean> {
    const profile = this.profiles.get(patientId);
    return { ok: true, value: profile ? profile.verificationStatus === "verified" : false };
  }
}

// Mock AccessTokenNFT contract
class AccessTokenNFTMock {
  private state: ContractState = {
    accessTokens: new Map(),
    tokenCounter: new Map(),
    accessAuditLog: new Map(),
    blockHeight: 100,
    contractCaller: "deployer",
  };

  private patientRegistry: PatientRegistryMock;

  private ERR_NOT_PATIENT = 200;
  private ERR_NOT_TOKEN_OWNER = 201;
  private ERR_INVALID_PATIENT = 202;
  private ERR_INVALID_SCOPE = 203;
  private ERR_TOKEN_NOT_FOUND = 204;
  private ERR_TOKEN_EXPIRED = 205;
  private ERR_UNAUTHORIZED = 206;
  private ERR_INVALID_DURATION = 207;
  private ERR_INVALID_RECIPIENT = 208;

  constructor() {
    this.patientRegistry = new PatientRegistryMock();
  }

  // Simulate block height increase
  private incrementBlockHeight() {
    this.state.blockHeight += 1;
  }

  // Expose for test setup
  setPatientProfile(patientId: string, profile: PatientProfile) {
    this.patientRegistry.setProfile(patientId, profile);
  }

  mintToken(
    caller: string,
    patientId: string,
    recipient: string,
    scopes: string[],
    duration: number,
    terms: string
  ): ClarityResponse<number> {
    const patientProfile = this.patientRegistry.getPatientProfile(patientId);
    if (!patientProfile.value || typeof patientProfile.value === "number") {
      return { ok: false, value: this.ERR_INVALID_PATIENT };
    }
    if (patientProfile.value.owner !== caller) {
      return { ok: false, value: this.ERR_NOT_PATIENT };
    }
    if (!this.patientRegistry.isPatientVerified(patientId).value) {
      return { ok: false, value: this.ERR_INVALID_PATIENT };
    }
    if (!scopes.every(s => ["read-lab", "read-consult", "write-consult", "read-imaging", "emergency-access"].includes(s))) {
      return { ok: false, value: this.ERR_INVALID_SCOPE };
    }
    if (duration <= 0) {
      return { ok: false, value: this.ERR_INVALID_DURATION };
    }
    if (terms.length > 200) {
      return { ok: false, value: this.ERR_INVALID_DURATION };
    }
    if (caller === recipient) {
      return { ok: false, value: this.ERR_INVALID_RECIPIENT };
    }
    const currentCount = this.state.tokenCounter.get(patientId)?.count ?? 0;
    const newTokenId = currentCount + 1;
    this.state.accessTokens.set(newTokenId, {
      patientId,
      owner: recipient,
      issuedTo: recipient,
      scopes,
      expiry: this.state.blockHeight + duration,
      terms,
      issuedAt: this.state.blockHeight,
      active: true,
    });
    this.state.tokenCounter.set(patientId, { count: newTokenId });
    this.state.accessAuditLog.set(`${newTokenId}-0`, {
      action: "minted",
      by: caller,
      timestamp: this.state.blockHeight,
      notes: terms,
    });
    this.incrementBlockHeight();
    return { ok: true, value: newTokenId };
  }

  revokeToken(caller: string, tokenId: number): ClarityResponse<boolean> {
    const token = this.state.accessTokens.get(tokenId);
    if (!token) {
      return { ok: false, value: this.ERR_TOKEN_NOT_FOUND };
    }
    const patientProfile = this.patientRegistry.getPatientProfile(token.patientId);
    if (!patientProfile.value || typeof patientProfile.value === "number") {
      return { ok: false, value: this.ERR_INVALID_PATIENT };
    }
    if (patientProfile.value.owner !== caller && token.owner !== caller) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (!token.active || token.expiry <= this.state.blockHeight) {
      return { ok: false, value: this.ERR_TOKEN_EXPIRED };
    }
    token.active = false;
    const entryId = (Array.from(this.state.accessAuditLog.keys())
      .filter(key => key.startsWith(`${tokenId}-`)).length) + 1;
    this.state.accessAuditLog.set(`${tokenId}-${entryId}`, {
      action: "revoked",
      by: caller,
      timestamp: this.state.blockHeight,
      notes: "",
    });
    this.incrementBlockHeight();
    return { ok: true, value: true };
  }

  transferToken(caller: string, tokenId: number, newOwner: string): ClarityResponse<boolean> {
    const token = this.state.accessTokens.get(tokenId);
    if (!token) {
      return { ok: false, value: this.ERR_TOKEN_NOT_FOUND };
    }
    if (token.owner !== caller) {
      return { ok: false, value: this.ERR_NOT_TOKEN_OWNER };
    }
    if (!token.active || token.expiry <= this.state.blockHeight) {
      return { ok: false, value: this.ERR_TOKEN_EXPIRED };
    }
    const patientProfile = this.patientRegistry.getPatientProfile(token.patientId);
    if (!patientProfile.value || typeof patientProfile.value === "number" || patientProfile.value.owner === newOwner) {
      return { ok: false, value: this.ERR_INVALID_RECIPIENT };
    }
    token.owner = newOwner;
    token.issuedTo = newOwner;
    const entryId = (Array.from(this.state.accessAuditLog.keys())
      .filter(key => key.startsWith(`${tokenId}-`)).length) + 1;
    this.state.accessAuditLog.set(`${tokenId}-${entryId}`, {
      action: "transferred",
      by: caller,
      timestamp: this.state.blockHeight,
      notes: newOwner,
    });
    this.incrementBlockHeight();
    return { ok: true, value: true };
  }

  logAccess(caller: string, tokenId: number, notes: string): ClarityResponse<boolean> {
    const token = this.state.accessTokens.get(tokenId);
    if (!token) {
      return { ok: false, value: this.ERR_TOKEN_NOT_FOUND };
    }
    if (token.owner !== caller) {
      return { ok: false, value: this.ERR_NOT_TOKEN_OWNER };
    }
    if (!token.active || token.expiry <= this.state.blockHeight) {
      return { ok: false, value: this.ERR_TOKEN_EXPIRED };
    }
    const entryId = (Array.from(this.state.accessAuditLog.keys())
      .filter(key => key.startsWith(`${tokenId}-`)).length) + 1;
    this.state.accessAuditLog.set(`${tokenId}-${entryId}`, {
      action: "accessed",
      by: caller,
      timestamp: this.state.blockHeight,
      notes,
    });
    this.incrementBlockHeight();
    return { ok: true, value: true };
  }

  getTokenDetails(tokenId: number): ClarityResponse<AccessToken | null> {
    return { ok: true, value: this.state.accessTokens.get(tokenId) ?? null };
  }

  getTokenCount(patientId: string): ClarityResponse<number> {
    return { ok: true, value: this.state.tokenCounter.get(patientId)?.count ?? 0 };
  }

  getAuditLogEntry(tokenId: number, entryId: number): ClarityResponse<AuditLogEntry | null> {
    return { ok: true, value: this.state.accessAuditLog.get(`${tokenId}-${entryId}`) ?? null };
  }

  hasAccess(tokenId: number, caller: string): ClarityResponse<boolean> {
    const token = this.state.accessTokens.get(tokenId);
    if (!token) {
      return { ok: true, value: false };
    }
    return { ok: true, value: token.owner === caller && token.active && token.expiry > this.state.blockHeight };
  }

  getTokenScopes(tokenId: number): ClarityResponse<string[] | number> {
    const token = this.state.accessTokens.get(tokenId);
    if (!token) {
      return { ok: false, value: this.ERR_TOKEN_NOT_FOUND };
    }
    return { ok: true, value: token.scopes };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  patient: "patient_1",
  doctor: "doctor_1",
  doctor2: "doctor_2",
};

describe("AccessTokenNFT Contract", () => {
  let contract: AccessTokenNFTMock;

  beforeEach(() => {
    contract = new AccessTokenNFTMock();
    vi.resetAllMocks();
    // Setup verified patient
    contract.setPatientProfile("a".repeat(64), {
      owner: accounts.patient,
      registrationTimestamp: 100,
      lastUpdated: 100,
      metadata: "Patient metadata",
      verificationStatus: "verified",
      verifier: "verifier_1",
      emergencyContacts: [],
    });
  });

  it("should mint a new access token", () => {
    const patientId = "a".repeat(64);
    const scopes = ["read-lab", "read-consult"];
    const result = contract.mintToken(accounts.patient, patientId, accounts.doctor, scopes, 100, "Read access");
    expect(result).toEqual({ ok: true, value: 1 });
    const token = contract.getTokenDetails(1);
    expect(token.value).toEqual(expect.objectContaining({
      patientId,
      owner: accounts.doctor,
      scopes,
      active: true,
    }));
    const audit = contract.getAuditLogEntry(1, 0);
    expect(audit.value?.action).toBe("minted");
  });

  it("should prevent minting by non-patient", () => {
    const patientId = "a".repeat(64);
    const result = contract.mintToken(accounts.doctor, patientId, accounts.doctor2, ["read-lab"], 100, "Terms");
    expect(result).toEqual({ ok: false, value: 200 });
  });

  it("should prevent minting with invalid scopes", () => {
    const patientId = "a".repeat(64);
    const result = contract.mintToken(accounts.patient, patientId, accounts.doctor, ["invalid"], 100, "Terms");
    expect(result).toEqual({ ok: false, value: 203 });
  });

  it("should prevent minting to patient", () => {
    const patientId = "a".repeat(64);
    const result = contract.mintToken(accounts.patient, patientId, accounts.patient, ["read-lab"], 100, "Terms");
    expect(result).toEqual({ ok: false, value: 208 });
  });
  
  it("should prevent revocation by unauthorized", () => {
    const patientId = "a".repeat(64);
    contract.mintToken(accounts.patient, patientId, accounts.doctor, ["read-lab"], 100, "Terms");
    const revoke = contract.revokeToken(accounts.doctor2, 1);
    expect(revoke).toEqual({ ok: false, value: 206 });
  });

  it("should prevent transfer by non-owner", () => {
    const patientId = "a".repeat(64);
    contract.mintToken(accounts.patient, patientId, accounts.doctor, ["read-lab"], 100, "Terms");
    const transfer = contract.transferToken(accounts.doctor2, 1, accounts.doctor2);
    expect(transfer).toEqual({ ok: false, value: 201 });
  });

  it("should prevent access logging by non-owner", () => {
    const patientId = "a".repeat(64);
    contract.mintToken(accounts.patient, patientId, accounts.doctor, ["read-lab"], 100, "Terms");
    const log = contract.logAccess(accounts.doctor2, 1, "Unauthorized access");
    expect(log).toEqual({ ok: false, value: 201 });
  });

  it("should check access correctly", () => {
    const patientId = "a".repeat(64);
    contract.mintToken(accounts.patient, patientId, accounts.doctor, ["read-lab"], 100, "Terms");
    const hasAccess = contract.hasAccess(1, accounts.doctor);
    expect(hasAccess).toEqual({ ok: true, value: true });
    const noAccess = contract.hasAccess(1, accounts.doctor2);
    expect(noAccess).toEqual({ ok: true, value: false });
  });

  it("should return token scopes", () => {
    const patientId = "a".repeat(64);
    const scopes = ["read-lab", "write-consult"];
    contract.mintToken(accounts.patient, patientId, accounts.doctor, scopes, 100, "Terms");
    const tokenScopes = contract.getTokenScopes(1);
    expect(tokenScopes).toEqual({ ok: true, value: scopes });
  });

  it("should handle expired token", () => {
    const patientId = "a".repeat(64);
    contract.mintToken(accounts.patient, patientId, accounts.doctor, ["read-lab"], 1, "Terms");
    // Simulate block height passing expiry
    contract['state'].blockHeight += 100;
    const revoke = contract.revokeToken(accounts.doctor, 1);
    expect(revoke).toEqual({ ok: false, value: 205 });
    const access = contract.hasAccess(1, accounts.doctor);
    expect(access).toEqual({ ok: true, value: false });
  });
});