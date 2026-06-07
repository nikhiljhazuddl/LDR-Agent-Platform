import winston from 'winston';
import { getConfig } from '../config.js';

let logger: winston.Logger | null = null;

export function getLogger(): winston.Logger {
  if (logger) return logger;
  const config = getConfig();

  logger = winston.createLogger({
    level: config.logLevel,
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({ filename: 'event-intel.log' })
    ]
  });

  return logger;
}

