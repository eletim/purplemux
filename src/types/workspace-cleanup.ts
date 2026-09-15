export type TDeleteWorkspaceIfEmptyResult =
  | { workspaceId: string; status: 'deleted'; deleted: true }
  | { workspaceId: string; status: 'absent'; deleted: false }
  | {
    workspaceId: string;
    status: 'not-empty';
    deleted: false;
    tabCount: number;
    sessionCount: number;
  };

export type TWorkspaceCleanupItemResult = TDeleteWorkspaceIfEmptyResult | {
  workspaceId: string;
  status: 'error';
  deleted: false;
  error: string;
};

export interface IWorkspaceCleanupResponse {
  results: TWorkspaceCleanupItemResult[];
}
