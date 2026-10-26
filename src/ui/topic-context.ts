import { inject, type InjectionKey } from "vue";

export interface TopicContext {
  title: string;
  /** Called by the page heading whenever the visible page title changes. */
  showHeading(title: string, element: HTMLElement): void;
}

export const topicContextKey: InjectionKey<TopicContext> =
  Symbol("topic-context");

export function useTopicContext() {
  return inject(topicContextKey, null);
}
