import { migrate } from "../db.js";
import { logger } from "../logger.js";

migrate();
logger.info("migrations applied");
process.exit(0);
