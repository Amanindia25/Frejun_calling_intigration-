import { Request, Response } from "express";
import { IAppConfig } from "../config/app.config";
import { ApiResponse } from "../types/api.types";
import { maskPhoneNumber } from "../utils/phone.utils";

export class HealthController {
  private config: IAppConfig;

  constructor(config: IAppConfig) {
    this.config = config;
  }

  public check = (_req: Request, res: Response): void => {
    const isMock = !this.config.frejun.apiKey || this.config.frejun.apiKey.includes("YOUR_API_KEY");

    res.status(200).json({
      success: true,
      message: "Hashtagg FreJun Telephony Service is online",
      data: {
        status: "healthy",
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        environment: this.config.nodeEnv,
        provider: "frejun",
        mode: isMock ? "simulation_mode" : "live_mode",
        configuredCallerNumber: maskPhoneNumber(this.config.frejun.callerNumber),
        publicBaseUrl: this.config.publicBaseUrl,
        flowAction: this.config.frejun.flowAction,
        dialBridgeTarget: this.config.frejun.dialBridgeTarget
          ? maskPhoneNumber(this.config.frejun.dialBridgeTarget)
          : undefined,
      },
    } as ApiResponse);
  };
}
