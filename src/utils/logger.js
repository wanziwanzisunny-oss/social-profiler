import chalk from 'chalk';

const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = levels[process.env.LOG_LEVEL || 'info'];

export const logger = {
  debug: (...args) => {
    if (currentLevel <= 0) console.log(chalk.gray('[DEBUG]'), ...args);
  },
  info: (...args) => {
    if (currentLevel <= 1) console.log(chalk.blue('[INFO]'), ...args);
  },
  warn: (...args) => {
    if (currentLevel <= 2) console.log(chalk.yellow('[WARN]'), ...args);
  },
  error: (...args) => {
    if (currentLevel <= 3) console.error(chalk.red('[ERROR]'), ...args);
  },
};
