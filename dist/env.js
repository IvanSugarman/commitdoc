import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/** 当前文件路径 */
const ENV_MODULE_PATH = fileURLToPath(import.meta.url);
/** 项目根目录 */
export const PROJECT_ROOT = path.dirname(path.dirname(ENV_MODULE_PATH));
/** 环境变量目录 */
export const ENV_DIR = path.join(PROJECT_ROOT, '.env');
/** 当前激活的环境变量文件 */
export const ACTIVE_ENV_PATH = path.join(ENV_DIR, 'active.env');
dotenv.config({
    path: ACTIVE_ENV_PATH,
    override: true
});
