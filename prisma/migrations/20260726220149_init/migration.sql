-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "linkedinProfileUrl" TEXT NOT NULL,
    "icpDescription" TEXT NOT NULL,
    "coreTopic" TEXT NOT NULL,
    "scoringTweaks" TEXT,
    "maxPostsPerRun" INTEGER NOT NULL DEFAULT 5,
    "backfillMonths" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "linkedinMemberId" TEXT NOT NULL,
    "linkedinUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headline" TEXT,
    "aboutSummary" TEXT,
    "followerCount" INTEGER,
    "premiumProfile" BOOLEAN NOT NULL DEFAULT false,
    "relevanceScore" INTEGER,
    "warmthScore" INTEGER,
    "aiAssessment" TEXT,
    "manualFitTier" TEXT,
    "enrichmentConfidence" INTEGER,
    "lifecycleStatus" TEXT NOT NULL DEFAULT 'NEW',
    "dismissedAt" DATETIME,
    "snoozedUntil" DATETIME,
    "companyId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Person_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Person_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "industry" TEXT,
    "nicheDescription" TEXT,
    "website" TEXT,
    CONSTRAINT "Company_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "postTitleHook" TEXT NOT NULL,
    "postUrl" TEXT NOT NULL,
    "datePublished" DATETIME NOT NULL,
    CONSTRAINT "Post_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EngagementEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "postId" TEXT,
    "eventType" TEXT NOT NULL,
    "contentOfComment" TEXT,
    "date" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EngagementEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EngagementEvent_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EngagementEvent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "processOnly" BOOLEAN NOT NULL DEFAULT false,
    "batchGroupId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "heartbeatAt" DATETIME,
    "postsSynced" INTEGER,
    "syncedPostTitles" JSONB NOT NULL DEFAULT [],
    "peopleFound" INTEGER,
    "peopleEnriched" INTEGER,
    "peopleScored" INTEGER,
    "errorMessage" TEXT,
    CONSTRAINT "PipelineRun_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_accountId_linkedinMemberId_key" ON "Person"("accountId", "linkedinMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_accountId_companyName_key" ON "Company"("accountId", "companyName");

-- CreateIndex
CREATE UNIQUE INDEX "Post_accountId_postUrl_key" ON "Post"("accountId", "postUrl");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementEvent_personId_postId_eventType_date_key" ON "EngagementEvent"("personId", "postId", "eventType", "date");
