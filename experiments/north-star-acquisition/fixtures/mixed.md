# Mixed forms

Inline: [alpha](https://alpha-linkaudit.dev/a).
Autolink: <https://bravo-linkaudit.io/b>.
Email autolink: <audit@charlie-linkaudit.org>.
Mailto: [mail](mailto:delta@charlie-linkaudit.org).
Bare GFM URL: https://echo-linkaudit.dev/e
Reference: [foxtrot][ref]

[ref]: https://foxtrot-linkaudit.io/f

Reserved-domain link that a checker may exclude: [reserved](https://example.com/reserved).
Subdomain of a reserved label, not itself reserved: [kept](https://sub.example.io/kept).

```text
fenced, so not a link: https://fenced-linkaudit.dev/ignored
```

Inline code `https://inline-linkaudit.dev/ignored` is not a link either.

<!-- comment: https://comment-linkaudit.dev/hidden -->
