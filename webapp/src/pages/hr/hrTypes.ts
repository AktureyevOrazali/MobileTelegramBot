export type HrRequestType =
  | 'vacation'
  | 'advance'
  | 'sickLeave'
  | 'businessTrip'
  | 'certificate'
  | 'serviceLetter';

export type HrRequestStatus =
  | 'new'
  | 'review'
  | 'needsInfo'
  | 'approved'
  | 'rejected'
  | 'archived';

export type HrCalendarEventType =
  | 'vacation'
  | 'sickLeave'
  | 'shift'
  | 'birthday'
  | 'probation'
  | 'businessTrip';

export interface HrEmployee {
  id: string;
  fullName: string;
  position: string;
  department: string;
  location: string;
  phone: string;
  email: string;
  photoUrl: string;
  hireDate: string;
  schedule: string;
  statuses: string[];
  documentCompleteness: number;
}

export interface HrRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeePhotoUrl: string;
  department: string;
  type: HrRequestType;
  status: HrRequestStatus;
  period: string;
  submittedAt: string;
  updatedAt: string;
  summary: string;
  approvalChain: string[];
}

export interface HrCalendarEvent {
  id: string;
  employeeId: string;
  employeeName: string;
  type: HrCalendarEventType;
  label: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface HrTemplate {
  id: string;
  title: string;
  type: HrRequestType;
  updatedAt: string;
  variables: string[];
  preview: string;
}

export interface HrArchiveItem {
  id: string;
  employeeName: string;
  type: HrRequestType;
  finalStatus: Extract<HrRequestStatus, 'approved' | 'rejected' | 'archived'>;
  decisionDate: string;
  responsible: string;
}
