# Safe Regex Patterns

When you use `.match()`, `.search()`, `.replace()`, or `.split()` in `$if` expressions, the pattern string is validated for safety. This prevents "ReDoS" attacks — regex patterns that can hang the bot.

## What Works

| Feature | Example | Notes |
|---------|---------|-------|
| Literals | `"hello"` | Match exact text |
| Dot | `"a.b"` | Match any character |
| Anchors | `"^hello$"` | Start/end of string |
| Word boundary | `"\\bhello\\b"` | Word edges |
| Alternation | `"cat\|dog"` | Match either |
| Character classes | `"[a-z]"`, `"[^0-9]"` | Character sets |
| Shorthand classes | `"\\d"`, `"\\w"`, `"\\s"` | Digits, word chars, whitespace |
| Negated shorthands | `"\\D"`, `"\\W"`, `"\\S"` | Opposites |
| Escapes | `"\\t"`, `"\\n"`, `"\\r"` | Tab, newline, return |
| Escaped specials | `"\\."`, `"\\\\"`, `"\\+"` | Literal special characters |
| Quantifiers | `"a+"`, `"b*"`, `"c?"` | One+, zero+, optional |
| Brace quantifiers | `"a{3}"`, `"a{1,5}"`, `"a{2,}"` | Exact, range, min |
| Lazy quantifiers | `"a+?"`, `"b*?"` | Non-greedy |
| Non-capturing groups | `"(?:ab)+"` | Grouping without capture |

## What's Blocked

| Feature | Example | Why |
|---------|---------|-----|
| Capturing groups | `"(abc)"` | Causes backtracking. Use `(?:abc)` instead |
| Nested quantifiers | `"(?:a+)+"` | Catastrophic backtracking (hangs the bot) |
| Backreferences | `"\\1"` | Can cause exponential matching time |
| Lookahead | `"(?=abc)"` | Not allowed |
| Negative lookahead | `"(?!abc)"` | Not allowed |
| Lookbehind | `"(?<=abc)"` | Not allowed |
| Negative lookbehind | `"(?<!abc)"` | Not allowed |
| Named groups | `"(?<name>abc)"` | Use `(?:abc)` instead |
| Dynamic patterns | `content.match(name)` | Variable patterns are not allowed |

## Common Patterns

```
$if content.match("\\d+"): contains numbers
$if content.match("\\bhello\\b"): someone said hello
$if content.match("[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+"): contains email
$if content.search("https?://[^\\s]+") >= 0: contains URL
$if content.split("\\s+").length > 5: more than 5 words
$if content.replace("\\d+", "").length < content.length: had digits removed
```

## Safe Alternatives

If you just need to check for exact text (no regex features), use these instead — they're simpler and don't have any restrictions:

```
$if content.includes("hello"): literal match
$if content.startsWith("!"): starts with !
$if content.endsWith("?"): ends with ?
$if content.indexOf("test") >= 0: find position
```

## The Nested Quantifier Rule

The key safety rule: **a quantifier cannot be applied to something that already contains a quantifier**. This prevents the most common class of ReDoS vulnerabilities.

```
a+b+c+        -- safe (quantifiers at same level)
(?:a+)         -- safe (quantifier inside group, no outer quantifier)
(?:ab)+        -- safe (outer quantifier, nothing quantified inside)
(?:a+)+        -- BLOCKED (inner + and outer + = nested quantifiers)
(?:a+b*)+      -- BLOCKED (group has quantified children + outer quantifier)
```

If you hit the nested quantifier error, you can usually flatten the pattern. For example, instead of `(?:a{3}){3}`, write `a{9}`.
