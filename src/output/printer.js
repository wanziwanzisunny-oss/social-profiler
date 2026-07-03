import chalk from 'chalk';
import ora from 'ora';

/** 安全地 join 数组，非数组则原样返回 */
function safeJoin(val, sep = '、') {
  if (Array.isArray(val)) return val.join(sep);
  if (typeof val === 'string') return val;
  return '';
}

/**
 * 终端美化输出
 */
export const printer = {
  /**
   * 创建进度指示器
   */
  spinner(text) {
    return ora({
      text,
      color: 'cyan',
    });
  },

  /**
   * 打印标题
   */
  title(text) {
    console.log('\n' + chalk.bold.cyan(`━━━ ${text} ━━━`) + '\n');
  },

  /**
   * 打印成功信息
   */
  success(text) {
    console.log(chalk.green('✓ ') + text);
  },

  /**
   * 打印信息
   */
  info(text) {
    console.log(chalk.blue('ℹ ') + text);
  },

  /**
   * 打印警告
   */
  warn(text) {
    console.log(chalk.yellow('⚠ ') + text);
  },

  /**
   * 打印错误
   */
  error(text) {
    console.error(chalk.red('✖ ') + text);
  },

  /**
   * 打印键值对
   */
  kv(key, value) {
    if (value) {
      console.log(`  ${chalk.gray(key + ':')} ${value}`);
    }
  },

  /**
   * 打印报告摘要
   */
  summary(data, analysis) {
    this.title('客户画像报告');

    this.kv('目标', `${data.query.name}${data.query.company ? ` @ ${data.query.company}` : ''}`);
    this.kv('数据来源', Object.keys(data.platforms).filter((k) => data.platforms[k]?.found !== false).join(', '));
    this.kv('采集时间', new Date(data.fetchedAt).toLocaleString('zh-CN'));

    if (analysis.person) {
      console.log();
      this.info(chalk.bold('个人画像'));
      this.kv('职位', analysis.person.role);
      this.kv('决策层级', analysis.person.decisionLevel);
      this.kv('专业领域', safeJoin(analysis.person.expertise));
    }

    if (analysis.company) {
      console.log();
      this.info(chalk.bold('公司信息'));
      this.kv('主营', safeJoin(analysis.company.mainProducts));
      this.kv('规模', analysis.company.scale);
    }

    if (analysis.salesInsights?.entryPoints?.length) {
      console.log();
      this.info(chalk.bold('商务切入点'));
      analysis.salesInsights.entryPoints.forEach((ep, i) => {
        console.log(`  ${i + 1}. ${ep}`);
      });
    }

    console.log();
  },
};
