export interface ProgressLineItem {
  level: 'info' | 'warning' | 'error';
  message: string;
}

type AgentProgressStatus = 'working' | 'done';

const LEVEL_PREFIX: Record<ProgressLineItem['level'], string> = {
  error: '- 💥💥 ERROR:',
  warning: '- ⚠️⚠️ WARNING: ',
  info: '- '
} as const;

/**
 * Responsible for generating markdown content for an issue comment that shows the user the
 * current agent progress. This also logs progress to the console (which gets picked up by GitHub actions logs)
 */
export class AgentProgressReport {
  private _status: AgentProgressStatus = 'working';
  private lineItems: ProgressLineItem[] = [];
  private listeners: Function[] = [];

  public get status(): AgentProgressStatus {
    return this._status;
  }

  public set status(status: AgentProgressStatus) {
    this._status = status;
    console.info(`Status set to "${status}"`);
    this.notifyListeners();
  }

  public info(message: string) {
    this.lineItems.push({ level: 'info', message });
    console.info(message);
    this.notifyListeners();
  }

  public warning(message: string) {
    this.lineItems.push({ level: 'warning', message });
    console.warn(message);
    this.notifyListeners();
  }

  public error(message: string) {
    this.lineItems.push({ level: 'error', message });
    console.error(message);
    this.notifyListeners();
  }

  public onProgressUpdated(fn: Function) {
    this.listeners.push(fn);
  }

  public toMarkdown() {
    return this.lineItems.map(item => `${LEVEL_PREFIX[item.level]} ${item.message}`).join('\n');
  }

  private notifyListeners() {
    this.listeners.forEach(fn => fn());
  }
}