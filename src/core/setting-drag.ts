export const SETTING_DRAG_MIME = "application/x-novelview-setting-drag";

export interface SettingRecordDragPayload {
  kind: "record";
  group: string;
  tag: string;
  keyword: string;
  content?: string;
}


export const SETTING_RECORD_DROP_EVENT = "novelview-setting-record-drop";
