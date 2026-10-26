export type TaskStatus = "todo" | "doing" | "done";

export const TASK_STATUSES: TaskStatus[] = ["todo", "doing", "done"];

export interface Task {
  id: number;
  title: string;
  status: TaskStatus;
  createdAt: string;
}

/** The statuses a task may move to from each status: forward only, and done stays done. */
export const NEXT_STATUSES: Record<TaskStatus, TaskStatus[]> = {
  todo: ["doing", "done"],
  doing: ["todo", "done"],
  done: [],
};
