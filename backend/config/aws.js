const AWS = require('aws-sdk');
const logger = require('../utils/logger');

// Configure AWS SDK
AWS.config.update({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

// Initialize AWS services
const s3 = new AWS.S3();
const dynamodb = new AWS.DynamoDB.DocumentClient();
const pricing = new AWS.Pricing({ region: 'us-east-1' }); // Pricing API only available in us-east-1
const cloudwatch = new AWS.CloudWatch();
const ec2 = new AWS.EC2();
const rds = new AWS.RDS();
const lambda = new AWS.Lambda();
const iam = new AWS.IAM();

// Terraform state configuration
const terraformStateConfig = {
  bucket: process.env.TERRAFORM_STATE_BUCKET || 'company-terraform-state',
  table: process.env.TERRAFORM_STATE_TABLE || 'terraform-state-locks',
  region: process.env.AWS_REGION || 'us-east-1'
};

// Initialize DynamoDB table for state locking if it doesn't exist
const initializeStateLockTable = async () => {
  try {
    const dynamodbService = new AWS.DynamoDB();
    
    const tableParams = {
      TableName: terraformStateConfig.table,
      KeySchema: [
        { AttributeName: 'LockID', KeyType: 'HASH' }
      ],
      AttributeDefinitions: [
        { AttributeName: 'LockID', AttributeType: 'S' }
      ],
      BillingMode: 'PAY_PER_REQUEST'
    };

    try {
      await dynamodbService.describeTable({ TableName: terraformStateConfig.table }).promise();
      logger.info(`DynamoDB table ${terraformStateConfig.table} already exists`);
    } catch (error) {
      if (error.code === 'ResourceNotFoundException') {
        await dynamodbService.createTable(tableParams).promise();
        logger.info(`Created DynamoDB table ${terraformStateConfig.table} for Terraform state locking`);
      } else {
        throw error;
      }
    }
  } catch (error) {
    logger.error('Error initializing state lock table:', error);
    // Don't throw - table might already exist or permissions issue
  }
};

// Initialize S3 bucket for Terraform state if it doesn't exist
const initializeStateBucket = async () => {
  try {
    const bucketName = terraformStateConfig.bucket;
    
    try {
      await s3.headBucket({ Bucket: bucketName }).promise();
      logger.info(`S3 bucket ${bucketName} already exists`);
    } catch (error) {
      if (error.statusCode === 404) {
        await s3.createBucket({
          Bucket: bucketName,
          CreateBucketConfiguration: {
            LocationConstraint: terraformStateConfig.region
          }
        }).promise();
        
        // Enable versioning
        await s3.putBucketVersioning({
          Bucket: bucketName,
          VersioningConfiguration: {
            Status: 'Enabled'
          }
        }).promise();
        
        // Enable encryption
        await s3.putBucketEncryption({
          Bucket: bucketName,
          ServerSideEncryptionConfiguration: {
            Rules: [{
              ApplyServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256'
              }
            }]
          }
        }).promise();
        
        logger.info(`Created S3 bucket ${bucketName} for Terraform state`);
      } else {
        throw error;
      }
    }
  } catch (error) {
    logger.error('Error initializing state bucket:', error);
    // Don't throw - bucket might already exist or permissions issue
  }
};

module.exports = {
  s3,
  dynamodb,
  pricing,
  cloudwatch,
  ec2,
  rds,
  lambda,
  iam,
  terraformStateConfig,
  initializeStateLockTable,
  initializeStateBucket
};

