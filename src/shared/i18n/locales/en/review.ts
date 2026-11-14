/** English texts (reference): namespace `review` – review changes (diff, commit, worktrees) */
const en = {
  title: 'Review changes · {project}',
  kindModified: 'modified',
  kindAdded: 'added',
  kindDeleted: 'deleted',
  kindUntracked: 'new (not yet in Git)',
  confirmDiscardUnsaved: 'Discard unsaved changes to the file?',
  commentsSent: 'Comments sent to {name}.',
  noRepo:
    'The agent folder of this project is not inside a Git repository – without Git there is nothing to compare.',
  targetTooltip: 'Working directory: main folder or an agent’s worktree',
  refresh: 'Refresh',
  comparedToFork: 'Compared with the fork point from “{base}” (incl. the agent’s commits)',
  comparedToHead: 'Compared with the last commit',
  mergeTooltip: 'Merge the worktree’s branch into the branch checked out in the main folder',
  merge: 'Merge',
  removeWorktreeRunningTooltip: 'The worktree stays as long as its agent is running',
  removeWorktreeTooltip: 'Delete worktree and branch',
  confirmRemoveWorktree:
    'Delete worktree “{label}” including its branch?\nChanges that were not merged will be lost.',
  removeWorktree: 'Delete worktree',
  noChanges: 'No changes.',
  saveTooltip: 'Write the right side to the file',
  discardNewTooltip: 'Delete the new file',
  discardTooltip: 'Reset the file to the compared state',
  confirmDiscard: 'Discard all changes to “{file}”?',
  discard: 'Discard',
  binary: 'Binary file or too large – no comparison.',
  commentPlaceholder:
    'Comment on the selected lines (select lines on the right, Enter adds it to the list)',
  commentPlaceholderNoAgent: 'Comments go to the agent of this directory – none is running here',
  addComment: 'Add',
  removeComment: 'remove',
  sendComments_one: 'Send {count} comment to {name}',
  sendComments_other: 'Send {count} comments to {name}',
  commitPlaceholder: 'Commit message',
  commitFileTooltip: 'Commit only the selected file',
  commitFile: 'Commit file',
  commitAll: 'Commit all'
}

export default en
