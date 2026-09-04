# Model releases

This directory stores small manifests that identify the exact PFF release used
by the public inference service. Checkpoints and training artifacts are hosted
in a Hugging Face model repository, never committed to this Git repository.

Every deployed manifest must pin the model repository revision, checkpoint,
configuration, preprocessing mode, source process and numerical solver defaults.
