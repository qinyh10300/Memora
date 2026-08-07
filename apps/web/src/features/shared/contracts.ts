import type { components } from "@memora/api-contract";

export type CurrentUser = components["schemas"]["CurrentUserResponse"];
export type Workspace = components["schemas"]["WorkspaceResponse"];
export type WorkspaceMember = components["schemas"]["WorkspaceMemberResponse"];
export type WorkspaceJoinRequest = components["schemas"]["WorkspaceJoinRequestResponse"];
export type Subscription = components["schemas"]["SubscriptionResponse"];
export type Plan = components["schemas"]["PlanResponse"];
export type CreditLedgerEntry = components["schemas"]["CreditLedgerEntryResponse"];
export type Diagram = components["schemas"]["DiagramResponse"];
export type DiagramNodeInput = components["schemas"]["DiagramNodeInput"];
export type DiagramEdgeInput = components["schemas"]["DiagramEdgeInput"];
export type ImageModel = components["schemas"]["ImageModelResponse"];
export type VisualProject = components["schemas"]["VisualProjectResponse"];
export type VisualJob = components["schemas"]["VisualJobResponse"];
export type VisualVersion = components["schemas"]["VisualVersionResponse"];
export type VisualTemplate = components["schemas"]["VisualTemplateResponse"];
export type GenerateVisualRequest = components["schemas"]["GenerateVisualRequest"];
export type GeneratedReport = components["schemas"]["ReportResponse"];
export type ReportSubscription = components["schemas"]["ReportSubscriptionResponse"];
export type AlignmentTopic = components["schemas"]["AlignmentTopicResponse"];
export type AlignmentPosition = components["schemas"]["AlignmentPositionResponse"];
export type DecisionRecord = components["schemas"]["DecisionRecordResponse"];
export type ConversationSummary = components["schemas"]["ConversationSummaryResponse"];
export type ConversationDetail = components["schemas"]["ConversationDetailResponse"];
export type Memory = components["schemas"]["MemoryResponse"];
export type EvidenceCitation = components["schemas"]["EvidenceCitationResponse"];
export type WebCitation = components["schemas"]["WebCitationResponse"];
export type DraftDocumentCitation = components["schemas"]["DraftDocumentCitationResponse"];
export type DocumentCitation = components["schemas"]["DocumentCitationResponse"];
export type DocumentStatus = components["schemas"]["DocumentStatusResponse"];
export type DraftModel = components["schemas"]["DraftModelResponse"];
export type DraftImageInput = components["schemas"]["DraftImageInput"];
export type DraftChatResponse = components["schemas"]["DraftChatResponse"];
export type DraftTrace = components["schemas"]["DraftTraceResponse"];
export type DraftTraceStep = components["schemas"]["DraftTraceStepResponse"];
export type Asset = components["schemas"]["AssetResponse"];
export type AssetMediaType = components["schemas"]["CreateAssetRequest"]["media_type"];
export type WebSearchMode = components["schemas"]["DraftChatRequest"]["web_search"];
export type RevisionMode = components["schemas"]["CreateMemoryRevisionRequest"]["mode"];
export type MemoryVisibility = components["schemas"]["CreateMemoryRequest"]["visibility"];
export type AvatarMediaType = components["schemas"]["UpdateAvatarRequest"]["media_type"];

export type AppView =
  "CAPTURE" | "RESEARCH" | "KNOWLEDGE" | "DIAGRAMS" | "INSIGHTS" | "LIBRARY" | "TEAM";
export type SettingsView = "PROFILE" | "SECURITY";
export type PublicAuthMode = "LOGIN" | "REGISTER";
export type TeamAccessMode = "CREATE" | "CREATE_FAMILY" | "JOIN";

export function isCollaborativeWorkspace(workspace: Workspace) {
  return workspace.kind === "TEAM" || workspace.kind === "FAMILY";
}

export type MemorySearchFilters = {
  query: string;
  field: "ALL" | "TITLE";
  from: string;
  to: string;
  authorId: string;
};

export type DraftImageAttachment = DraftImageInput & {
  id: string;
  assetId: string;
  markdownUrl: string;
  previewUrl: string;
};

export type DraftImagePreview = Pick<DraftImageAttachment, "id" | "name" | "previewUrl">;

export type DraftDocumentAttachment = {
  id: string;
  assetId: string;
  name: string;
  mediaType: AssetMediaType;
  sizeBytes: number;
  document: DocumentStatus;
};

export type DraftDocumentPreview = Pick<
  DraftDocumentAttachment,
  "id" | "name" | "mediaType" | "document"
>;

export type DraftMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  meta?: string;
  citations?: EvidenceCitation[];
  webCitations?: WebCitation[];
  documentCitations?: DraftDocumentCitation[];
  images?: DraftImagePreview[];
  attachments?: DraftDocumentPreview[];
  activity?: DraftTrace;
};

export const EMPTY_MEMORY_SEARCH: MemorySearchFilters = {
  query: "",
  field: "ALL",
  from: "",
  to: "",
  authorId: "",
};

export const INITIAL_DRAFT_MESSAGE: DraftMessage = {
  id: "welcome",
  role: "ASSISTANT",
  content: "告诉我一个想法，或者让我整理、补充右侧草稿。",
  meta: "只有点击“保存为我的记忆”后，内容才会进入记忆库",
};
