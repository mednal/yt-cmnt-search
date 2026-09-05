/** Renders one search result. */
import type { SearchMode, SearchResultItem } from '@yca/shared';

import { element } from './dom.ts';
import { formatAge, formatLikes, formatScore } from './format.ts';

/**
 * A result is a `<li>` carrying its YouTube comment id: M9 turns these into
 * jump targets, and the id is what it needs to find the comment in the page.
 */
export function resultItem(item: SearchResultItem, mode: SearchMode): HTMLElement {
  const node = element('li', 'result');
  node.dataset.commentId = item.youtubeCommentId;

  const head = element('div', 'result__head');
  head.append(element('span', 'result__author', item.author));
  if (item.parentCommentId !== null) {
    head.append(element('span', 'tag', 'reply'));
  }
  const age = formatAge(item.publishedAt);
  if (age !== null) {
    head.append(element('span', 'result__age', age));
  }

  const foot = element('div', 'result__foot');
  foot.append(
    element('span', 'result__likes', `${formatLikes(item.likeCount)} likes`),
    element('span', 'result__score', formatScore(item.score, mode)),
  );

  node.append(head, element('p', 'result__text', item.text), foot);
  return node;
}
