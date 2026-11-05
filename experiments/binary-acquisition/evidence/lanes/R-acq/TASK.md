# Task (acquisition)

Three programs are installed: /opt/homebrew/bin/ppm2tiff, /opt/homebrew/bin/cwebp, /opt/homebrew/bin/dwebp.

Later, other AI agents with no memory of this session will be asked to convert image files between formats. They will not be told which conversions in advance. Make these programs' image-conversion abilities available to them through RightClick X, an MCP server you reach with the `./rcx` command in this directory:

    ./rcx tools                         # list RightClick's tools and their schemas
    ./rcx call <tool> '<json-args>'     # call one tool

Rules:
- Do not write conversion scripts or wrappers. Whatever you establish must live in RightClick's own state, which later agents inherit.
- Work only in this directory. Do not run the image programs directly.

Finish by writing HANDOFF.md (at most 20 lines) for the next agent, and report what is now available and how you know.
