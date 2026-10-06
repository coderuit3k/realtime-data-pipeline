"""Normalize free text before it is embedded or stored: no markup, emoji, newlines, case,
unnecessary punctuation or stopwords.

Shared by the transform Lambda (new records), rag/build_index.py (Qdrant), the agent (the user's
question) and scripts/normalize_curated.py (S3 history). Standard library only: it ships in every
Lambda zip.
"""

import html
import re
import unicodedata

ENGLISH_STOPWORDS = frozenset(
    {
        "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "is",
        "are", "was", "were", "this", "that", "these", "those", "with", "it", "its", "as",
        "be", "been", "being", "by", "from", "has", "have", "had", "having", "not", "no",
        "nor", "will", "would", "can", "could", "shall", "should", "may", "might", "must",
        "do", "does", "did", "doing", "than", "then", "there", "here", "when", "where",
        "which", "while", "who", "whom", "whose", "why", "how", "what", "about", "above",
        "after", "again", "against", "all", "am", "any", "because", "before", "below",
        "between", "both", "each", "few", "further", "he", "her", "hers", "him", "himself",
        "his", "into", "just", "me", "more", "most", "my", "myself", "once", "only",
        "other", "our", "ours", "out", "over", "own", "same", "she", "so", "some", "such",
        "that", "their", "theirs", "them", "themselves", "they", "through", "too", "under",
        "until", "up", "very", "we", "you", "your", "yours", "yourself", "yourselves", "i",
        "if", "off", "down", "during", "second", "third", "first", "many", "much", "one",
        "two", "three", "also", "still", "even", "now", "get", "gets", "got", "like",
        "make", "makes", "made", "new", "way", "back", "using", "used", "use", "says",
        "said"
    }
)
# Dropping these flips meaning ("does not support" must not become "support").
NEGATIONS = frozenset({"not", "no", "nor", "never"})
INDEX_STOPWORDS = ENGLISH_STOPWORDS - NEGATIONS

_STYLE_SCRIPT = re.compile(r"<(style|script)\b[^>]*>.*?</\1\s*>", re.I | re.S)
_COMMENT = re.compile(r"<!--.*?-->", re.S)
# A tag or a character entity: the only things strip_markup changes. Text without either is
# returned as is, so a stored text_hash (and its embedding) stay valid.
_MARKUP = re.compile(r"</?[a-zA-Z][^>]*>|&(?:#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);")
_TAG = re.compile(r"</?([a-zA-Z][a-zA-Z0-9]*)[^>]*>")
# Block-level tags separate words ("calls.<p>A decision"); inline ones just disappear.
_BLOCK_TAGS = {
    "p", "br", "hr", "li", "ul", "ol", "div", "pre", "blockquote",
    "table", "tr", "th", "td", "h1", "h2", "h3",
}
_INVISIBLE = {"\ufe0f", "\u200d", "\u20e3"}  # variation selector, zero-width joiner, keycap
_LEADING_KEEP = "$@#"
_TRAILING_KEEP = "+#%"


def strip_markup(text: str) -> str:
    """Strip HTML tags and decode entities.

    Tags go first and entities second, so an escaped &lt;div&gt; stays the literal text the author
    wrote. Applied to raw text only: running it on its own output would treat that literal text as
    a tag.
    """
    text = _COMMENT.sub(" ", _STYLE_SCRIPT.sub(" ", text))
    if not _MARKUP.search(text):
        return text
    decoded = _TAG.sub(lambda m: " " if m.group(1).lower() in _BLOCK_TAGS else "", text)
    for _ in range(5):  # "&amp;lt;" needs two rounds; stop once nothing changes
        unescaped = html.unescape(decoded)
        if unescaped == decoded:
            break
        decoded = unescaped
    return " ".join(decoded.split())


def _is_punctuation(ch: str) -> bool:
    return unicodedata.category(ch)[0] in ("P", "S")


def _is_word_char(ch: str) -> bool:
    """Letters and digits, plus combining marks so a trailing accent is not trimmed."""
    return ch.isalnum() or unicodedata.category(ch)[0] == "M"


def _strip_token(token: str) -> str:
    """Trim punctuation from both ends of one whitespace-separated chunk, keep the inside."""
    start = 0
    while start < len(token) and _is_punctuation(token[start]):
        if (
            token[start] in _LEADING_KEEP
            and start + 1 < len(token)
            and token[start + 1].isalnum()
        ):
            break
        start += 1
    last = len(token) - 1
    while last >= start and not _is_word_char(token[last]):
        last -= 1
    if last < start:
        return ""  # no letter or digit left
    end = last + 1
    while end < len(token) and token[end] in _TRAILING_KEEP:
        end += 1
    return token[start:end]


def normalize_text(text: str | None) -> str:
    """Return `text` as lowercase space-separated tokens without markup, emoji or stopwords."""
    if not text:
        return ""
    text = unicodedata.normalize("NFC", strip_markup(text))
    # A decoded "&lt;t&gt;" is literal text now, but a later pass would read "<t>" as a tag, so no
    # angle bracket may survive: that keeps normalize_text a fixed point.
    text = text.replace("<", " ").replace(">", " ")
    text = "".join(
        " " if unicodedata.category(ch) in ("So", "Sk") else ch
        for ch in text
        if ch not in _INVISIBLE
    )
    words = []
    for chunk in text.lower().split():
        token = _strip_token(chunk)
        if token and token not in INDEX_STOPWORDS:
            words.append(token)
    return " ".join(words)
