import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { APP_CONFIG, type AppConfig } from "../config/config.js";

/** Lets a request through only when its x-api-key header is the configured key. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.header("x-api-key") !== this.config.apiKey) {
      throw new UnauthorizedException("a valid x-api-key header is required");
    }
    return true;
  }
}
