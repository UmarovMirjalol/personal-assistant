export { getOAuthClient, getGmailAuthUrl, exchangeCodeForTokens, saveGmailTokens, getAuthorizedGmail, isGmailConnected, fetchProfileEmail } from "@/lib/gmail/oauth";
export {
  listRecentEmails,
  getEmailByGmailId,
  searchEmails,
  upsertEmailRecord,
  sendGmailReply,
  setupGmailWatch,
  listHistoryMessages,
  type ParsedEmail,
} from "@/lib/gmail/client";
export { analyzeEmail, analyzeAndStore, shouldNotify, type EmailAnalysis } from "@/lib/gmail/analyze";
export { processNewEmailsForUser, processAllConnectedUsers } from "@/lib/gmail/sync";
