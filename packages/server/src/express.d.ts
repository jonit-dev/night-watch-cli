/* eslint-disable @typescript-eslint/naming-convention */
import type { INightWatchConfig } from "../types";

declare module "express" {
  export interface Request {
    projectDir?: string;
    projectConfig?: INightWatchConfig;
  }
}
