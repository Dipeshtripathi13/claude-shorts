# Changelog — Tangent

## 1.1.0

**The search phrase is editable.** It sits prefilled in a text field above the
button rather than printed as a caption. Read it and click as before, or type
over it when the guess is not quite what you meant. An edited phrase is
searched verbatim and gets its own cache key, so it is never served the
guess's results.

**Better topic wording.** A two-part topic now reads in the order you wrote it.
"How can I reverse a linked list?" was becoming *linked list reverse* and is
now *reverse linked list*, which is both the natural phrase and the better
search.

Store listing: removed the enumerated list of chat-assistant names, which was
rejected under the Keyword Spam policy.

## 1.0.0

First release. Reads the message you just sent to an AI chat assistant, works
out the concept locally, and offers to find short explainer videos about it.
Nothing is searched until you click.

- Runs on sixteen AI chat sites, each individually switchable
- Searches with your own YouTube Data API key; 90-of-100 daily cap and a
  topic-keyed cache to stay inside it
- Redacts code, paths, URLs and credentials before anything is derived, and
  drops a message entirely if it looks like it contains a secret
- Suppresses chores: "yes", "rerun the tests", "commit this" raise nothing
- Plays inline beside the conversation, and narrows the page to sit next to it
