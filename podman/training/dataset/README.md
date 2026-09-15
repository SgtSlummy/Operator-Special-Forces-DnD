# D&D LoRA dataset

Create one or more repeat/trigger folders. Every image should have a matching caption file with the same basename.

```text
10_dndforge/
├── ranger-01.png
├── ranger-01.txt
├── cleric-01.png
└── cleric-01.txt
```

The folder prefix (`10`) is the repeat count. Use a rare trigger word such as `dndforge`, then describe the subject, pose, clothing, lighting, and composition in each `.txt` file.

Use only images you are allowed to train on. Start with 20–50 varied images for a style or recurring character. Avoid near-duplicates; they encourage memorization.
