const chalk = require('chalk');

class Logger {
  info(message, ...args) {
    console.log(chalk.blue('ℹ'), message, ...args);
  }

  success(message, ...args) {
    console.log(chalk.green('✓'), message, ...args);
  }

  error(message, ...args) {
    console.error(chalk.red('✗'), message, ...args);
  }

  warn(message, ...args) {
    console.warn(chalk.yellow('⚠'), message, ...args);
  }

  debug(message, ...args) {
    if (process.env.DEBUG) {
      console.log(chalk.gray('DEBUG:'), message, ...args);
    }
  }
}

module.exports = new Logger();





