/**
 * Chrome's built-in translator wraps text nodes in <font> tags. React then
 * calls removeChild/insertBefore on nodes that are no longer direct children
 * and the meeting error boundary unmounts the room.
 * Ignore those NotFoundError cases so a translated page can keep reconciling.
 * https://github.com/facebook/react/issues/11538
 */
export function installDomRemoveChildGuard() {
  if (typeof Node !== 'function' || Node.prototype.__laliaDomGuard) return;

  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function removeChild(child) {
    if (child && child.parentNode !== this) return child;
    return originalRemoveChild.call(this, child);
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function insertBefore(newNode, referenceNode) {
    if (referenceNode && referenceNode.parentNode !== this) return newNode;
    return originalInsertBefore.call(this, newNode, referenceNode);
  };

  Node.prototype.__laliaDomGuard = true;
}
