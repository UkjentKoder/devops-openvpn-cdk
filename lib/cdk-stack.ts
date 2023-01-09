import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as keypair from "cdk-ec2-key-pair"
import * as path from 'path';
import { Construct } from 'constructs';
import { RDS_LOWERCASE_DB_IDENTIFIER } from 'aws-cdk-lib/cx-api';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class Ec2CdkStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    
    // Create instance
    
    const vpc = ec2.Vpc.fromLookup(this, "VPC", {
      isDefault: true
    });

    const key = new keypair.KeyPair(this, "KeyPair", {
      name: "openvpn-keypair"
    });
    key.grantReadOnPublicKey;

    const securityGroup = new ec2.SecurityGroup(this, "openvpn-SG", {
      vpc,
      description: "Default security group for OpenVPN",
      allowAllOutbound: true
    });

    securityGroup.addIngressRule(
      // ec2.Peer.ipv4(123.45.67.89/32),
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      "SSH"
    );

    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(445),
      "HTTPS"
    );

    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(943),
      "OpenVPN Web GUI"
    );

    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(945),
      "Cluster control channel"
    );

    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udp(1194),
      "OpenVPN UDP"
    );

    const ami = new ec2.LookupMachineImage({
      name: "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"
    });

    const openvpnRole = new iam.Role(this, "openvpnRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com")
    });

    openvpnRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );

    const ec2Instance = new ec2.Instance(this, "openvpn", {
      vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3A,
        ec2.InstanceSize.NANO
      ),
      machineImage: ami,
      securityGroup: securityGroup,
      keyName: key.keyPairName,
      role: openvpnRole
    });

    // Create MySQL RDS

    const dbInstance = new rds.DatabaseInstance(this, 'db-instance', {
      vpc,
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0_31
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3A,
        ec2.InstanceSize.NANO
      ),
      // Generates credentials for username 'db-user' and puts them in the Secrets Manager
      // Possible unsafe alternative, define a secret with secretsmanager.Secret
      credentials: rds.Credentials.fromGeneratedSecret('db-user'),
      multiAz: true,
      allocatedStorage: 4,
      maxAllocatedStorage: 8,
      allowMajorVersionUpgrade: false,
      autoMinorVersionUpgrade: true,
      backupRetention: cdk.Duration.days(1),
      deleteAutomatedBackups: true,
      // Removal policy?
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
      databaseName: 'openvpn-db',
      publiclyAccessible: false,
    });

    dbInstance.connections.allowFrom(ec2Instance, ec2.Port.tcp(3306))
    
    // Outputs database hostname
    new cdk.CfnOutput(this, 'dbEndpoint', {
      value: dbInstance.instanceEndpoint.hostname,
    });
    
    // Outputs secret name
    new cdk.CfnOutput(this, 'secretName', {
      value: dbInstance.secret?.secretName!,
    });
  }
}
