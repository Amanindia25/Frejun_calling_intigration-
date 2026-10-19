import dotenv from "dotenv";
import { isValidE164 } from "../utils/phone.utils";
import { CallFlowActionType } from "../types/frejun.types";

dotenv.config();

export interface IAppConfig {
  port: number;
  nodeEnv: "development" | "production" | "test";
  publicBaseUrl: string;
  frejun: {
    apiKey: string;
    clientId?: string;
    clientSecret?: string;
    callerNumber: string;
    webhookSecret: string;
    flowAction: CallFlowActionType;
    flowMediaUrl: string;
    dialBridgeTarget?: string;
    webhookToleranceSeconds: number;
  };
  callSettings: {
    duplicateCooldownSeconds: number;
    defaultRecord: boolean;
  };
  logLevel: "debug" | "info" | "warn" | "error";
}

export class AppConfig {
  private static instance: IAppConfig;

  public static get(): IAppConfig {
    if (!AppConfig.instance) {
      AppConfig.instance = AppConfig.load();
    }
    return AppConfig.instance;
  }

  private static load(): IAppConfig {
    const port = parseInt(process.env.PORT || "3000", 10);
    const nodeEnv = (process.env.NODE_ENV || "development") as "development" | "production" | "test";
    const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, "");

    const apiKey = process.env.FREJUN_API_KEY || "";
    const clientId = process.env.FREJUN_CLIENT_ID || "";
    const clientSecret = process.env.FREJUN_CLIENT_SECRET || "";
    const callerNumber = process.env.FREJUN_CALLER_NUMBER || "";
    const webhookSecret = process.env.FREJUN_WEBHOOK_SECRET || "";

    const rawFlowAction = (process.env.FREJUN_FLOW_ACTION || "play").toLowerCase();
    const validActions: CallFlowActionType[] = ["play", "dial", "stream", "hangup"];
    const flowAction: CallFlowActionType = validActions.includes(rawFlowAction as CallFlowActionType)
      ? (rawFlowAction as CallFlowActionType)
      : "play";

    const flowMediaUrl =
      process.env.FREJUN_FLOW_MEDIA_URL ||
      "https://actions.google.com/sounds/v1/telephones/phone_calling.ogg";

    const dialBridgeTarget = process.env.FREJUN_DIAL_BRIDGE_TARGET;

    const duplicateCooldownSeconds = parseInt(
      process.env.DUPLICATE_CALL_COOLDOWN_SECONDS || "15",
      10
    );

    const webhookToleranceSeconds = parseInt(
      process.env.FREJUN_WEBHOOK_TOLERANCE_SECONDS || "300",
      10
    );

    const defaultRecord = process.env.FREJUN_RECORD_CALLS === "false" ? false : true;
    const logLevel = (process.env.LOG_LEVEL || "info") as "debug" | "info" | "warn" | "error";

    return {
      port,
      nodeEnv,
      publicBaseUrl,
      frejun: {
        apiKey,
        clientId,
        clientSecret,
        callerNumber,
        webhookSecret,
        flowAction,
        flowMediaUrl,
        dialBridgeTarget,
        webhookToleranceSeconds,
      },
      callSettings: {
        duplicateCooldownSeconds,
        defaultRecord,
      },
      logLevel,
    };
  }

  /**
   * Validates configuration completeness and logs warnings for production readiness.
   */
  public static validate(config: IAppConfig): { isValid: boolean; warnings: string[]; errors: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.frejun.apiKey) {
      warnings.push("FREJUN_API_KEY is not set. Live outbound calling to Teler will fail (demo/mock mode active).");
    }

    if (!config.frejun.callerNumber) {
      warnings.push("FREJUN_CALLER_NUMBER is not set. A caller number provisioned on FreJun Teler is required for live calls.");
    } else if (!isValidE164(config.frejun.callerNumber)) {
      warnings.push(`FREJUN_CALLER_NUMBER '${config.frejun.callerNumber}' is not in valid E.164 format (e.g. +91XXXXXXXXXX).`);
    }

    if (!config.frejun.webhookSecret) {
      warnings.push("FREJUN_WEBHOOK_SECRET is not set. Webhook signature verification will operate in permissive mode.");
    }

    if (config.frejun.flowAction === "dial" && !config.frejun.dialBridgeTarget) {
      warnings.push("FREJUN_FLOW_ACTION is set to 'dial', but FREJUN_DIAL_BRIDGE_TARGET is missing. Dial bridging requires a target number.");
    }

    if (config.publicBaseUrl.includes("localhost") && config.nodeEnv === "production") {
      warnings.push("PUBLIC_BASE_URL is set to localhost in production. FreJun webhooks and flow callbacks require a publicly reachable HTTPS URL.");
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
