const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const sns = require("@pulumi/aws/sns");
const gcp = require("@pulumi/gcp");

// Create a pulumi.Config instance to access configuration settings
const config = new pulumi.Config();

// Use configuration settings or provide defaults
const vpcCidr = config.require("vpcCidr");
const cidr = config.require("cidr");
const cidrEnd = config.require("cidrEnd");
const vpcName = config.require("vpcName");
const internetGatewayName = config.require("internetGatewayName");
const publicRouteTableName = config.require("publicRouteTableName");
const privateRouteTableName = config.require("privateRouteTableName");
const publicRouteCidrBlock = config.require("publicRouteCidrBlock");
const amiID = config.require("amiID");
const hostedZones = config.require("hostedZone")
const MAILGUN_API_KEY = config.require("MAILGUN_API_KEY")
const MAILGUN_DOMAIN = config.require("MAILGUN_DOMAIN")
const Certificate_arn= config.require("certificate_arn")
//const gcp_project = config.require('gcp:project1')
//const gcp_project = new pulumi.Config().require('gcp:project1');
const subnetIds = [];

const vpc = new aws.ec2.Vpc(vpcName, {
  cidrBlock: vpcCidr,
});

const igw = new aws.ec2.InternetGateway(internetGatewayName, {
  vpcId: vpc.id,
});

const publicRouteTable = new aws.ec2.RouteTable(publicRouteTableName, {
  vpcId: vpc.id,
  // routes: [{ cidrBlock: publicRouteCidrBlock, gatewayId: igw.id }],
});
const publicRoute = new aws.ec2.Route(publicRouteTableName, {
  routeTableId: publicRouteTable.id,

  destinationCidrBlock: publicRouteCidrBlock,

  gatewayId: igw.id,
});

const privateRouteTable = new aws.ec2.RouteTable(privateRouteTableName, {
  vpcId: vpc.id,
});

// Create a Google Cloud Storage Bucket
const bucket = new gcp.storage.Bucket("my-bucket-uq11-ar", {
  location: "US",
  forceDestroy: true,
});
// const bucket1 = new gcp.storage.Bucket("my-bucket-uq-ar", {
//   location: "US",
// });

// Create a Google Service Account
const serviceAccount = new gcp.serviceaccount.Account("my-service-account-uq-ar", {
  accountId: "my-service-account-uq-ar",
  displayName: "My Service Account-uq-ar",
});

// Create a Google Service Account Key
const serviceAccountKey = new gcp.serviceaccount.Key("my-service-account-key-uq-ar", {
  serviceAccountId: serviceAccount.name,
});

const serviceAccountEmail = serviceAccount.email.apply(email => email);

// Grant permissions to the Service Account for the bucket
const bucketIAMBinding = new gcp.storage.BucketIAMBinding("bucketIamBinding", {
    bucket: bucket.name,
    role: "roles/storage.objectAdmin", // Role granting storage.objects.create permission
    members: [serviceAccount.email.apply(email => `serviceAccount:${email}`)],
});


const azs = aws.getAvailabilityZones();
const publicSubnetIds = [];
const privateSubnetIds = [];

const calculateCidrBlock = (index, subnetType) => {
  const subnetNumber = subnetType === "public" ? index * 2 : index * 2 + 1;
  return `${cidr}.${subnetNumber}.${cidrEnd}`; // Use backticks for template literals
};

azs.then((az) => {
  const maxSubnets = 6;
  let subnetCount = 0;

  az.names.forEach((zoneName, azIndex) => {
    if (subnetCount >= maxSubnets) return;

    let subnetsToCreate;

    if (az.names.length <= 2) {
      subnetsToCreate = azIndex === 0 ? 2 : 2;
    } else {
      subnetsToCreate = 2;
    }

    for (let i = 0; i < subnetsToCreate; i++) {
      if (subnetCount >= maxSubnets) break;

      const subnetType = i % 2 === 0 ? "public" : "private";
      const routeTable =
        subnetType === "public" ? publicRouteTable : privateRouteTable;
      const subnetName = `${subnetType}-subnet-${subnetCount}`;

      const subnet = new aws.ec2.Subnet(subnetName, {
        vpcId: vpc.id,
        availabilityZone: zoneName,
        cidrBlock: calculateCidrBlock(subnetCount, subnetType),
        mapPublicIpOnLaunch: subnetType === "public",
      });

      new aws.ec2.RouteTableAssociation(`${subnetType}-rta-${subnetCount}`, {
        subnetId: subnet.id,
        routeTableId: routeTable.id,
      });

      subnetCount++;

      if (subnetType === "public") {
        publicSubnetIds.push(subnet.id); // Add public subnet IDs to the array
      }

      if (subnetType === "private") {
        privateSubnetIds.push(subnet.id); // Add public subnet IDs to the array
      }
    }
  });

  // Randomly select a public subnet from the array
  if (publicSubnetIds.length > 0) {
    publicSubnetId =
      publicSubnetIds[Math.floor(Math.random() * publicSubnetIds.length)];
  }

  const snsTopic = new sns.Topic("mySnsTopic");

  const lambdaRole = new aws.iam.Role("lambdaRole", {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [{
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: {
          Service: "lambda.amazonaws.com",
        },
      }],
    }),
  });
  
  // Attach the AWSLambdaBasicExecutionRole policy to the Lambda role
  const executionRolePolicyAttachment = new aws.iam.RolePolicyAttachment("executionRolePolicyAttachment", {
    role: lambdaRole,
    policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
  });

  const dynamoDBFullAccessPolicyAttachment = new aws.iam.RolePolicyAttachment("dynamoDBFullAccessPolicyAttachment", {
    role: lambdaRole,
    policyArn: "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess",
  });

  const nodeModulesLayer = new aws.lambda.LayerVersion("nodeModulesLayer", {
    layerName: "myNodeModulesLayer",
    code: new pulumi.asset.AssetArchive({
        "nodejs": new pulumi.asset.FileArchive("../serverless/nodejs")
    }),
    compatibleRuntimes: ["nodejs18.x"],
});
// Decode base64 encoded private key

  // Create a DynamoDB table for tracking emails

  const emailDynamo = new aws.dynamodb.Table("emailTable-uq-ar", {
    attributes: [
      { name: "Id", type: "S" },
    ],
    hashKey: "Id",
    billingMode: "PAY_PER_REQUEST",
  });

// Now decodedPrivateKey should contain the JSON-formatted private key

  const lambdaFunc = new aws.lambda.Function("myLambdaFunction", {
    runtime: aws.lambda.Runtime.NodeJS18dX,
    layers: [nodeModulesLayer.arn],
    handler: "index.handler",
    role: lambdaRole.arn,
    code: new pulumi.asset.FileArchive("../serverless"),
    environment: {
      variables: {
        // Set environment variables for the Lambda function
        //GCP_PROJECT:gcp_project,
        GCP_BUCKET_NAME: bucket.name,
        GCP_SERVICE_ACCOUNT_PRIVATE_KEY: serviceAccountKey.privateKey,
        MAILGUN_API_KEY: MAILGUN_API_KEY,
        MAILGUN_DOMAIN:MAILGUN_DOMAIN,
        DYNAMO_DB:emailDynamo.name,
      },
    },
  });
  
  // Create a subscription to the SNS topic that triggers the Lambda function
  const lambdaSubscription = new aws.sns.TopicSubscription("lambdaSubscription", {
    topic: snsTopic.arn,
    protocol: "lambda",
    endpoint: lambdaFunc.arn,
  });
  
  // Grant the SNS service permission to invoke the Lambda function
  const lambdaPermission = new aws.lambda.Permission("lambdaPermission", {
    action: "lambda:InvokeFunction",
    function: lambdaFunc.name,
    principal: "sns.amazonaws.com",
    sourceArn: snsTopic.arn,
  });
  


  const lbSecurityGroup = new aws.ec2.SecurityGroup("lb-security-group", {
    name:'lb-security-group',
    vpcId: vpc.id,
    ingress: [
      { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
      { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"] }
    ],
    egress: [
      { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }
    ]
  });

  const webAppSecurityGroup = new aws.ec2.SecurityGroup("webapp-sg", {
    name: 'webapp-sg',
    vpcId: vpc.id,
    ingress: [
      {
        fromPort: 22,
        toPort: 22,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"], // Allow SSH from anywhere
        // securityGroups: [lbSecurityGroup.id],
      },
      {
        fromPort: 8080, // The port your application uses
        toPort: 8080,
        protocol: "tcp",
        securityGroups: [lbSecurityGroup.id], // Only accept traffic from the load balancer security group
      },
    ],

    egress: [
      {
        fromPort: 3306,      // Allow outbound traffic on port 3306
        toPort: 3306,        // Allow outbound traffic on port 3306
        protocol: "tcp",     // TCP protocol
        cidrBlocks: ["0.0.0.0/0"],  // Allow all destinations
      },
      {
        fromPort: 443,      // Allow outbound traffic on port 3306
        toPort: 443,        // Allow outbound traffic on port 3306
        protocol: "tcp",     // TCP protocol
        cidrBlocks: ["0.0.0.0/0"],  // Allow all destinations
      },  
    ],
  });
  

  const dbSecurityGroup = new aws.ec2.SecurityGroup("db-sg", {
    vpcId: vpc.id,
    ingress: [
        {
            fromPort: 3306, // For MariaDB
            toPort: 3306, // For MariaDB
            protocol: "tcp",
            securityGroups: [webAppSecurityGroup.id], // Referencing the application security group as source
        },
    ],
    egress: [
        {
            fromPort: 0,
            toPort: 0,
            protocol: "-1",
            cidrBlocks: ["0.0.0.0/0"],
        },
    ],
  });

  const dbParameterGroup = new aws.rds.ParameterGroup("db-parameter-group", {
    family: "mariadb10.6", 
    description: "Custom Parameter Group for MariaDB",
  });

  // const selectedPrivateSubnet = privateSubnetIds[0];

  const rds_private_subnet_1 = privateSubnetIds[0];
  const rds_private_subnet_2 = privateSubnetIds[1];
  const rdsSubnetGroup = new aws.rds.SubnetGroup("db-subnet-group", {
    subnetIds: [rds_private_subnet_1, rds_private_subnet_2],
    description: "Subnet group for RDS instance using the first private subnet",
  });

  const rdsInstance = new aws.rds.Instance("csye6225", {
    engine: "mariadb", 
    instanceClass: "db.t2.micro",
    allocatedStorage: 20,
    name: "Your_Name",
    username: "Your_UserName",
    password: "Your_Password", 

    parameterGroupName: dbParameterGroup.name,
    skipFinalSnapshot: true,
    vpcSecurityGroupIds: [dbSecurityGroup.id],
    dbSubnetGroupName: rdsSubnetGroup.name, 
    publiclyAccessible: false,
    multiAz: false,
  });

  endpoint = rdsInstance.endpoint;

  //const selectedPublicSubnet = publicSubnetIds[0];
  const role = new aws.iam.Role("my-role", {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: {
            Service: "ec2.amazonaws.com",
          },
        },
      ],
    }),
  });
  
  const policy = new aws.iam.Policy("examplePolicy", {
    policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents",
            "logs:DescribeLogStreams",
            "cloudwatch:PutMetricData",
            "cloudwatch:GetMetricData",
            "cloudwatch:GetMetricStatistics",
            "cloudwatch:ListMetrics",
            "ec2:DescribeTags",
            "sns:Publish",
            "dynamodb:PutItem"
          ],
          Resource: "*",
        },
      ],
    }),
  });
  
  const rolePolicyAttachment = new aws.iam.RolePolicyAttachment(
    "my-role-policy-attachment",
    {
      role: role.name,
      // policyArn: aws.iam.getPolicy({ name: "CloudWatch_Permission" }).then(p => p.arn),
      policyArn: policy.arn,
    }
  );
  
  const instanceProfile = new aws.iam.InstanceProfile("my-instance-profile", {
    role: role.name,
  });

  const appLaunchTemplate = new aws.ec2.LaunchTemplate("app-launch-template", {
    name:"app-launch-template",
    vpcId: vpc.id,
    // imageId: "ami-091d8f20883d0c2db", 
    imageId: amiID,
    instanceType: "t2.micro",
    keyName: "webappKeyPair",
    blockDeviceMappings: [
      {
        deviceName: "/dev/xvda",
        ebs: {
          volumeSize: 25,
          volumeType: "gp2",
          deleteOnTermination: true,
        },
      },
    ],
    networkInterfaces: [
      {
        associatePublicIpAddress: true,
        securityGroups: [
          webAppSecurityGroup.id,
          lbSecurityGroup.id,
        ],
      },
    ],
    tagSpecifications: [{
      resourceType: "instance",
      tags: {
          Name: "WebAppInstance",
      },
  }],
  iamInstanceProfile: {
    name: instanceProfile.name, // Replace with your IAM role name
  },

    userData: pulumi.interpolate`#!/bin/bash
    echo "NODE_ENV=production" >> /etc/environment
    endpoint="${rdsInstance.endpoint}"
    echo "DB_HOST=\${endpoint%:*}" >> /etc/environment
    echo DB_USER=csye6225 >> /etc/environment
    echo DB_PASSWORD=root1234 >> /etc/environment
    echo DB_NAME=csye6225 >> /etc/environment
    echo SNS_ARN="${snsTopic.arn}" >> /etc/environment
    sudo systemctl start webapp
    sudo systemctl restart amazon-cloudwatch-agent
  `.apply((s) => Buffer.from(s).toString("base64")),
  });
  
  // Application Load Balancer
  const webAppAlb = new aws.lb.LoadBalancer("webAppAlb", {
    internal: false,
    securityGroups: [lbSecurityGroup.id],
    subnets: publicSubnetIds,
    loadBalancerType: "application",
  });
    // Target Group for the API
  const webAppTg = new aws.lb.TargetGroup("webAppTg", {
      port: 8080,
      protocol: "HTTP",
      vpcId: vpc.id,
      targetType: "instance",
      healthCheck: {
        enabled: true,
        path: "/healthz",
        protocol: "HTTP",
        port: "8080",
        healthyThreshold: 2,
        unhealthyThreshold: 2,
        timeout: 5,
        interval: 30,
        matcher: "200",
      },
    });

    // HTTPS Listener for the Application Load Balancer
const webAppHttpsListener = new aws.lb.Listener("webAppHttpsListener", {
    loadBalancerArn: webAppAlb.arn,
    port: 443,
    protocol: "HTTPS",
    sslPolicy: "ELBSecurityPolicy-2016-08", 
    certificateArn: Certificate_arn, 
    defaultActions: [{
        type: "forward",
        targetGroupArn: webAppTg.arn,
    }],
});



  // Auto Scaling Group
  const appAutoScalingGroup = new aws.autoscaling.Group("app-auto-scaling-group", {
    name:"app-auto-scaling-group",
    vpcZoneIdentifiers: publicSubnetIds,
    targetGroupArns: [webAppTg.arn],
    launchTemplate: {
      id: appLaunchTemplate.id,
    },

    minSize: 1,
    maxSize: 3,
    desiredCapacity: 1,
    healthCheckType: "EC2",
    healthCheckGracePeriod: 60,
    name: "app-auto-scaling-group",

  });
  
  // Create a DynamoDB table for tracking emails
  const emailTable = new aws.dynamodb.Table("emailTable", {
    attributes: [
      { name: "Id", type: "S" },
    ],
    hashKey: "Id",
    billingMode: "PAY_PER_REQUEST",
  });
  // Scaling Policies
  const scaleUpPolicy = new aws.autoscaling.Policy("scale-up-policy", {
    scalingAdjustment: 1,
    adjustmentType: "ChangeInCapacity",
    cooldown: 60,
    autoscalingGroupName: appAutoScalingGroup.name,
  });

  const scaleDownPolicy = new aws.autoscaling.Policy("scale-down-policy", {
    scalingAdjustment: -1,
    adjustmentType: "ChangeInCapacity",
    cooldown: 60,
    autoscalingGroupName: appAutoScalingGroup.name,
  });

  // High CPU Utilization Alarm - To trigger scale up
  const highCpuAlarm = new aws.cloudwatch.MetricAlarm("high-cpu-alarm", {
    alarmName: "HighCPUUtilization",
    comparisonOperator: "GreaterThanOrEqualToThreshold",
    evaluationPeriods: 2,
    metricName: "CPUUtilization",
    namespace: "AWS/EC2",
    period: 60,
    statistic: "Average",
    threshold: 5, // Threshold for high CPU utilization (in percent)
    alarmDescription: "Alarm when server CPU exceeds 5%",
    dimensions: {
      AutoScalingGroupName: appAutoScalingGroup.name,
    },
    alarmActions: [scaleUpPolicy.arn],
  });

  // Low CPU Utilization Alarm - To trigger scale down
  const cpuLowAlarm = new aws.cloudwatch.MetricAlarm("low-cpu-alarm", {
    alarmName: "LowCPUUtilization",
    comparisonOperator: "LessThanOrEqualToThreshold",
    evaluationPeriods: 2,
    metricName: "CPUUtilization",
    namespace: "AWS/EC2",
    period: 60,
    statistic: "Average",
    threshold: 3, // Threshold for low CPU utilization (in percent)
    alarmDescription: "Alarm when server CPU goes below 3%",
    dimensions: {
      AutoScalingGroupName: appAutoScalingGroup.name,
    },
    alarmActions: [scaleDownPolicy.arn],
  });

  const dnsRecord  = new aws.route53.Record("myDomainARecord", {
    zoneId: hostedZones,
    name: "",
    type: "A",
    aliases: [
      {
        name: webAppAlb.dnsName,
        zoneId: webAppAlb.zoneId,
        evaluateTargetHealth: true,
      },
    ],
  });

});
