# Back navigation

The shared patient workspace has a named secondary back button below its content, in the shared content column. Upload links home; confirmation and itemized-request preparation return to upload; findings return to document details; letters return to their preparation context; tracking reloads the latest saved case and opens its current draft. Existing uploads and local corrections are preserved. Busy operations disable the button. Confirmed facts remain locked; the separate correction action is required to reopen them.

Validation: production webpack build and lint passed. Real synthetic sample APIs at 1440px and 390px exercised upload → confirmation → findings → draft → tracking and backward navigation, retaining an edited code and the same case URL with no horizontal overflow or browser runtime errors.

On the upload screen, Back to home shares the action row with Continue to confirm. On narrow screens, readiness appears above the two side-by-side controls.
