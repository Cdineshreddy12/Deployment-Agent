const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const Deployment = require('../models/Deployment');
const logger = require('../utils/logger');

const execAsync = promisify(exec);

/**
 * Security Scanner Service
 * Scans Terraform code and infrastructure for security issues
 */
class SecurityScanner {
  constructor() {
    this.scanHistory = [];
    this.rules = this.loadSecurityRules();
  }

  /**
   * Load built-in security rules
   */
  loadSecurityRules() {
    return [
      // S3 Rules
      {
        id: 'S3_001',
        severity: 'critical',
        resource: 'aws_s3_bucket',
        check: 'public_access',
        title: 'S3 Bucket Public Access',
        description: 'S3 bucket should not allow public access',
        pattern: /acl\s*=\s*["']public/i,
        remediation: 'Set acl = "private" or use aws_s3_bucket_public_access_block'
      },
      {
        id: 'S3_002',
        severity: 'high',
        resource: 'aws_s3_bucket',
        check: 'encryption',
        title: 'S3 Bucket Encryption',
        description: 'S3 bucket should have encryption enabled',
        pattern: /server_side_encryption_configuration/,
        inverse: true,
        remediation: 'Add server_side_encryption_configuration block'
      },
      {
        id: 'S3_003',
        severity: 'medium',
        resource: 'aws_s3_bucket',
        check: 'versioning',
        title: 'S3 Bucket Versioning',
        description: 'S3 bucket should have versioning enabled',
        pattern: /versioning\s*{\s*enabled\s*=\s*true/,
        inverse: true,
        remediation: 'Enable versioning for data protection'
      },

      // Security Group Rules
      {
        id: 'SG_001',
        severity: 'critical',
        resource: 'aws_security_group',
        check: 'open_ingress',
        title: 'Open Security Group Ingress',
        description: 'Security group should not allow unrestricted ingress',
        pattern: /cidr_blocks\s*=\s*\[\s*["']0\.0\.0\.0\/0["']\s*\]/,
        remediation: 'Restrict CIDR blocks to specific IP ranges'
      },
      {
        id: 'SG_002',
        severity: 'high',
        resource: 'aws_security_group',
        check: 'ssh_open',
        title: 'SSH Open to World',
        description: 'SSH port 22 should not be open to 0.0.0.0/0',
        pattern: /from_port\s*=\s*22[\s\S]*?cidr_blocks\s*=\s*\[\s*["']0\.0\.0\.0\/0["']\s*\]/,
        remediation: 'Restrict SSH access to specific IP ranges or use bastion host'
      },
      {
        id: 'SG_003',
        severity: 'high',
        resource: 'aws_security_group',
        check: 'rdp_open',
        title: 'RDP Open to World',
        description: 'RDP port 3389 should not be open to 0.0.0.0/0',
        pattern: /from_port\s*=\s*3389[\s\S]*?cidr_blocks\s*=\s*\[\s*["']0\.0\.0\.0\/0["']\s*\]/,
        remediation: 'Restrict RDP access to specific IP ranges or use VPN'
      },

      // RDS Rules
      {
        id: 'RDS_001',
        severity: 'critical',
        resource: 'aws_db_instance',
        check: 'public_access',
        title: 'RDS Public Access',
        description: 'RDS instance should not be publicly accessible',
        pattern: /publicly_accessible\s*=\s*true/,
        remediation: 'Set publicly_accessible = false'
      },
      {
        id: 'RDS_002',
        severity: 'high',
        resource: 'aws_db_instance',
        check: 'encryption',
        title: 'RDS Encryption',
        description: 'RDS instance should have encryption enabled',
        pattern: /storage_encrypted\s*=\s*true/,
        inverse: true,
        remediation: 'Set storage_encrypted = true'
      },
      {
        id: 'RDS_003',
        severity: 'medium',
        resource: 'aws_db_instance',
        check: 'backup',
        title: 'RDS Backup Retention',
        description: 'RDS should have backup retention configured',
        pattern: /backup_retention_period\s*=\s*[1-9]/,
        inverse: true,
        remediation: 'Set backup_retention_period to at least 7 days'
      },

      // EC2 Rules
      {
        id: 'EC2_001',
        severity: 'high',
        resource: 'aws_instance',
        check: 'imdsv2',
        title: 'IMDSv2 Required',
        description: 'EC2 should require IMDSv2',
        pattern: /http_tokens\s*=\s*["']required["']/,
        inverse: true,
        remediation: 'Set metadata_options.http_tokens = "required"'
      },
      {
        id: 'EC2_002',
        severity: 'medium',
        resource: 'aws_instance',
        check: 'ebs_encryption',
        title: 'EBS Encryption',
        description: 'EBS volumes should be encrypted',
        pattern: /encrypted\s*=\s*true/,
        inverse: true,
        remediation: 'Set ebs_block_device.encrypted = true'
      },

      // IAM Rules
      {
        id: 'IAM_001',
        severity: 'critical',
        resource: 'aws_iam_policy',
        check: 'admin_access',
        title: 'IAM Admin Access',
        description: 'IAM policy should not grant full admin access',
        pattern: /"Action"\s*:\s*"\*"[\s\S]*?"Resource"\s*:\s*"\*"/,
        remediation: 'Follow principle of least privilege'
      },

      // Secrets Rules
      {
        id: 'SEC_001',
        severity: 'critical',
        resource: 'all',
        check: 'hardcoded_secrets',
        title: 'Hardcoded Secrets',
        description: 'Secrets should not be hardcoded in Terraform',
        pattern: /(password|secret|api_key|access_key)\s*=\s*["'][^"']+["']/i,
        remediation: 'Use AWS Secrets Manager or SSM Parameter Store'
      }
    ];
  }

  /**
   * Scan Terraform code for security issues
   * @param {string} deploymentId - Deployment to scan
   * @returns {Promise<Object>} - Scan results
   */
  async scan(deploymentId) {
    const startTime = Date.now();

    try {
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        throw new Error(`Deployment not found: ${deploymentId}`);
      }

      const terraformCode = deployment.terraformCode?.main || '';
      if (!terraformCode) {
        return {
          deploymentId,
          scannedAt: new Date(),
          issues: [],
          summary: { critical: 0, high: 0, medium: 0, low: 0 },
          message: 'No Terraform code to scan'
        };
      }

      // Run built-in rule checks
      const builtInIssues = this.runBuiltInRules(terraformCode);

      // Try to run external scanners if available
      const externalIssues = await this.runExternalScanners(deployment);

      // Combine and deduplicate issues
      const allIssues = [...builtInIssues, ...externalIssues];

      // Calculate summary
      const summary = {
        critical: allIssues.filter(i => i.severity === 'critical').length,
        high: allIssues.filter(i => i.severity === 'high').length,
        medium: allIssues.filter(i => i.severity === 'medium').length,
        low: allIssues.filter(i => i.severity === 'low').length
      };

      const result = {
        deploymentId,
        scannedAt: new Date(),
        duration: Date.now() - startTime,
        issues: allIssues,
        summary,
        score: this.calculateSecurityScore(summary),
        passed: summary.critical === 0 && summary.high === 0
      };

      // Store in history
      this.scanHistory.push(result);

      // Update deployment
      deployment.securityScan = {
        lastScanned: new Date(),
        passed: result.passed,
        score: result.score,
        issueCount: allIssues.length
      };
      await deployment.save();

      logger.info(`Security scan completed for ${deploymentId}`, {
        issues: allIssues.length,
        score: result.score
      });

      return result;

    } catch (error) {
      logger.error('Security scan failed:', error);
      throw error;
    }
  }

  /**
   * Run built-in security rules
   */
  runBuiltInRules(code) {
    const issues = [];

    for (const rule of this.rules) {
      const matches = code.match(rule.pattern);
      
      if (rule.inverse) {
        // Rule checks for absence of pattern
        if (!matches) {
          issues.push({
            ruleId: rule.id,
            severity: rule.severity,
            title: rule.title,
            description: rule.description,
            resource: rule.resource,
            remediation: rule.remediation
          });
        }
      } else {
        // Rule checks for presence of pattern
        if (matches) {
          issues.push({
            ruleId: rule.id,
            severity: rule.severity,
            title: rule.title,
            description: rule.description,
            resource: rule.resource,
            remediation: rule.remediation,
            finding: matches[0].substring(0, 100)
          });
        }
      }
    }

    return issues;
  }

  /**
   * Run external scanners (tfsec, checkov)
   */
  async runExternalScanners(deployment) {
    const issues = [];

    // Try to run tfsec
    try {
      const tfsecIssues = await this.runTfsec(deployment);
      issues.push(...tfsecIssues);
    } catch (error) {
      logger.debug('tfsec not available:', error.message);
    }

    // Try to run checkov
    try {
      const checkovIssues = await this.runCheckov(deployment);
      issues.push(...checkovIssues);
    } catch (error) {
      logger.debug('checkov not available:', error.message);
    }

    return issues;
  }

  /**
   * Run tfsec scanner
   */
  async runTfsec(deployment) {
    const issues = [];
    const terraformDir = path.join(process.cwd(), 'terraform', deployment.deploymentId);

    try {
      // Check if tfsec is available
      await execAsync('which tfsec');

      // Run tfsec
      const { stdout } = await execAsync(`tfsec ${terraformDir} --format json`, {
        timeout: 60000
      });

      const results = JSON.parse(stdout);
      
      for (const result of results.results || []) {
        issues.push({
          ruleId: result.rule_id,
          severity: result.severity.toLowerCase(),
          title: result.rule_description,
          description: result.description,
          resource: result.resource,
          location: result.location,
          remediation: result.resolution,
          scanner: 'tfsec'
        });
      }
    } catch (error) {
      // tfsec not available or failed
    }

    return issues;
  }

  /**
   * Run checkov scanner
   */
  async runCheckov(deployment) {
    const issues = [];
    const terraformDir = path.join(process.cwd(), 'terraform', deployment.deploymentId);

    try {
      // Check if checkov is available
      await execAsync('which checkov');

      // Run checkov
      const { stdout } = await execAsync(`checkov -d ${terraformDir} -o json`, {
        timeout: 120000
      });

      const results = JSON.parse(stdout);
      
      for (const check of results.results?.failed_checks || []) {
        issues.push({
          ruleId: check.check_id,
          severity: this.mapCheckovSeverity(check.severity),
          title: check.check_name,
          description: check.guideline,
          resource: check.resource,
          location: `${check.file_path}:${check.file_line_range}`,
          remediation: check.guideline,
          scanner: 'checkov'
        });
      }
    } catch (error) {
      // checkov not available or failed
    }

    return issues;
  }

  /**
   * Map checkov severity to standard
   */
  mapCheckovSeverity(severity) {
    const mapping = {
      'CRITICAL': 'critical',
      'HIGH': 'high',
      'MEDIUM': 'medium',
      'LOW': 'low'
    };
    return mapping[severity] || 'medium';
  }

  /**
   * Calculate security score (0-100)
   */
  calculateSecurityScore(summary) {
    const weights = {
      critical: 25,
      high: 15,
      medium: 5,
      low: 1
    };

    const deductions = 
      summary.critical * weights.critical +
      summary.high * weights.high +
      summary.medium * weights.medium +
      summary.low * weights.low;

    return Math.max(0, 100 - deductions);
  }

  /**
   * Auto-fix common security issues
   * @param {string} deploymentId - Deployment to fix
   * @returns {Promise<Object>} - Fix results
   */
  async autoFix(deploymentId) {
    const deployment = await Deployment.findOne({ deploymentId });
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    let code = deployment.terraformCode?.main || '';
    const fixes = [];

    // Fix: S3 public access
    if (/acl\s*=\s*["']public/i.test(code)) {
      code = code.replace(/acl\s*=\s*["']public[^"']*["']/gi, 'acl = "private"');
      fixes.push({ rule: 'S3_001', description: 'Changed S3 ACL to private' });
    }

    // Fix: RDS public accessibility
    if (/publicly_accessible\s*=\s*true/i.test(code)) {
      code = code.replace(/publicly_accessible\s*=\s*true/gi, 'publicly_accessible = false');
      fixes.push({ rule: 'RDS_001', description: 'Disabled RDS public accessibility' });
    }

    // Fix: Add RDS encryption
    if (/resource\s+"aws_db_instance"/.test(code) && !/storage_encrypted\s*=\s*true/.test(code)) {
      code = code.replace(
        /(resource\s+"aws_db_instance"\s+"[^"]+"\s*\{)/g,
        '$1\n  storage_encrypted = true'
      );
      fixes.push({ rule: 'RDS_002', description: 'Added RDS encryption' });
    }

    // Fix: Add EC2 IMDSv2
    if (/resource\s+"aws_instance"/.test(code) && !/http_tokens\s*=\s*["']required["']/.test(code)) {
      code = code.replace(
        /(resource\s+"aws_instance"\s+"[^"]+"\s*\{)/g,
        `$1
  metadata_options {
    http_tokens = "required"
  }`
      );
      fixes.push({ rule: 'EC2_001', description: 'Added IMDSv2 requirement' });
    }

    // Save fixed code
    if (fixes.length > 0) {
      deployment.terraformCode.main = code;
      await deployment.save();
    }

    return {
      deploymentId,
      fixesApplied: fixes.length,
      fixes,
      message: fixes.length > 0 
        ? `Applied ${fixes.length} security fixes` 
        : 'No auto-fixable issues found'
    };
  }

  /**
   * Get scan history
   */
  getHistory(deploymentId = null, limit = 10) {
    let history = this.scanHistory;
    
    if (deploymentId) {
      history = history.filter(h => h.deploymentId === deploymentId);
    }

    return history.slice(-limit);
  }

  /**
   * Get security report
   */
  async generateReport(deploymentId) {
    const scan = await this.scan(deploymentId);

    return {
      title: 'Security Scan Report',
      generatedAt: new Date(),
      deployment: deploymentId,
      summary: scan.summary,
      score: scan.score,
      passed: scan.passed,
      criticalIssues: scan.issues.filter(i => i.severity === 'critical'),
      highIssues: scan.issues.filter(i => i.severity === 'high'),
      mediumIssues: scan.issues.filter(i => i.severity === 'medium'),
      lowIssues: scan.issues.filter(i => i.severity === 'low'),
      recommendations: scan.issues.map(i => ({
        issue: i.title,
        remediation: i.remediation
      }))
    };
  }
}

// Singleton instance
const securityScanner = new SecurityScanner();

module.exports = securityScanner;





