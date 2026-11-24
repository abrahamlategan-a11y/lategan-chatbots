# Sum Sleuth results

This uses the existing Student Hub sign-in and stores completed rounds in Cloud Firestore. It needs a Firebase project with Firestore and Cloud Functions enabled. No student records are written until the save URL is configured.

Install the function dependencies from the `functions` directory. From this directory, deploy with `firebase deploy --only functions:saveSumSleuthRound --project PROJECT_ID`. For a shared Firestore project, add the collection rule in `firestore.rules` to the existing rules and check that no broader rule grants access. The included rules file is suitable as the entire ruleset for a dedicated project. Then set `ROUND_SAVE_URL` in `../save-config.mjs` to the deployed HTTPS URL.

The function verifies the student code with Learning Hub, takes the student ID from its response, and writes only the student ID, level, seed, total time in milliseconds and ordered wrong taps. A document ID derived from the student and run makes save retries safe.
