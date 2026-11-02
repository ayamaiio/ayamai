# Library preview images

The API creates lightweight image previews for video library cards while retaining the original media file.

## Runtime requirement

The API process must have `ffmpeg` available on its PATH. In the current Windows/WSL development setup, FFmpeg is installed in Ubuntu; see [Local WSL development](local-wsl-development.md). Any other runtime, including AWS, needs its own FFmpeg installation and a deployment check. The repository configuration alone does not establish that production has FFmpeg.

## Behavior

Preview work is bounded and produces a JPEG derivative up to 640 px on its longest edge and 96 KiB for cards. Original uploads are not transcoded or modified. Generation is on demand; an already available preview is reused unless refresh is requested. Private media remains behind application authorization and private object storage; preview generation does not make the source object public.

If a video has no preview, check that the API can read the source file and that `ffmpeg` is available to the API process, then inspect API logs for extraction or storage errors. Re-running preview generation should only refresh derivatives; preserve original files.

See the media routes and storage adapter for the current size limits, authorization checks, and generation path.
