from common import text_normalize as tn


def test_normalize_text_of_nothing_is_empty():
    assert tn.normalize_text(None) == ""
    assert tn.normalize_text("") == ""


def test_normalize_text_lowercases():
    assert tn.normalize_text("Rust Compiler") == "rust compiler"


def test_normalize_text_removes_style_script_comments_and_tags():
    raw = "<style>p{color:red}</style><p>Hello <script>x()</script>World</p><!-- note -->"

    assert tn.normalize_text(raw) == "hello world"


def test_normalize_text_decodes_entities():
    assert tn.normalize_text("ci &#x2F; cd &amp; deploys") == "ci cd deploys"


def test_normalize_text_keeps_escaped_angle_brackets_as_text():
    assert tn.normalize_text("render &lt;div&gt; tags") == "render div tags"


def test_normalize_text_removes_emoji_and_icons():
    assert tn.normalize_text("🔥 launch 🚀 day ✨ foo🔥bar") == "launch day foo bar"


def test_normalize_text_removes_newlines_and_tabs():
    assert tn.normalize_text("alpha\n\nbeta\tgamma") == "alpha beta gamma"


def test_normalize_text_removes_unnecessary_punctuation():
    assert tn.normalize_text('wow, "rust" (compiler!) fast...') == "wow rust compiler fast"


def test_normalize_text_keeps_technical_tokens_intact():
    raw = "C++ and C# beat Node.js v3.5 at $85,955.00 for R&D, 50% faster."

    assert tn.normalize_text(raw) == "c++ c# beat node.js v3.5 $85,955.00 r&d 50% faster"


def test_normalize_text_keeps_urls_without_trailing_punctuation():
    assert tn.normalize_text("docs: https://example.com/a?b=1.") == "docs https://example.com/a?b=1"


def test_normalize_text_removes_stopwords_but_keeps_negations():
    raw = "the compiler does not support this and never will"

    assert tn.normalize_text(raw) == "compiler not support never"
    assert tn.normalize_text("no results nor errors") == "no results nor errors"


def test_normalize_text_of_only_stopwords_is_empty():
    assert tn.normalize_text("what is the") == ""


def test_normalize_text_is_idempotent_on_ordinary_input():
    samples = [
        "The <b>Rust</b> Compiler!",
        "C++ and C# beat Node.js at $85,955.00 for R&D, 50% faster.",
        "docs: https://example.com/a?b=1.",
        "🔥 launch 🚀 day",
        "use &lt;div&gt; tags",
    ]

    for sample in samples:
        once = tn.normalize_text(sample)
        assert tn.normalize_text(once) == once


def test_stopword_sets_only_differ_by_the_negations():
    negations = {"not", "no", "nor", "never"}

    assert not negations & tn.INDEX_STOPWORDS
    assert "not" in tn.ENGLISH_STOPWORDS
    assert tn.INDEX_STOPWORDS == tn.ENGLISH_STOPWORDS - negations


def test_strip_markup_leaves_text_without_markup_untouched():
    text = "R&D  costs\nrise: a < b, x <3 y"

    assert tn.strip_markup(text) == text


def test_strip_markup_decodes_entities_and_strips_tags_in_order():
    raw = "use &lt;div&gt; for <b>layout</b> when a &lt; b &amp; calls.<p>A decision"

    assert tn.strip_markup(raw) == "use <div> for layout when a < b & calls. A decision"


def test_strip_markup_separates_table_cells_and_collapses_whitespace():
    raw = "<table><tr><th>name</th><th>stars</th></tr><tr><td>rust</td><td>9</td></tr></table>"

    assert tn.strip_markup(raw) == "name stars rust 9"


def test_normalize_text_is_idempotent_on_code_with_escaped_generics():
    """The backfill and the Lambda both normalize: a second pass must change nothing."""
    samples = [
        "Use List&lt;T&gt;.of(x) here",
        "Vec&lt;u8&gt;::new() works",
        "a &lt;i&gt;b&lt;/i&gt;c",
        "a&#38;lt;b",
        "a&ltb",
        "&amp;lt;",
    ]

    for sample in samples:
        once = tn.normalize_text(sample)
        assert tn.normalize_text(once) == once, (sample, once)


def test_normalize_text_is_idempotent_on_random_markup_like_strings():
    import random

    rng = random.Random(7)
    pieces = list("<>&;#x/ab1 +$%!'\"-.,\n\t") + [
        "İ", "é", "é", "😀", "&lt;", "&amp;", "&#38;", "<b>", "</b>", "<!--", "-->",
    ]
    failures = []
    for _ in range(5000):
        sample = "".join(rng.choice(pieces) for _ in range(rng.randint(1, 14)))
        once = tn.normalize_text(sample)
        if tn.normalize_text(once) != once:
            failures.append((sample, once, tn.normalize_text(once)))

    assert failures == []


def test_normalize_text_keeps_accents_on_decomposed_text():
    assert tn.normalize_text("café au lait") == "café au lait"
