# React + Vite

## Portal access setup

Set `VITE_ADMIN_EMAIL` to the administrator email before using `/admin`. The administrator Firebase user must also have the custom Auth claim `{ "admin": true }`; the included `firestore.rules` file enforces that claim for all employee records.

The admin page is available at `/admin`. Employees sign in at `/login`. Opening `/admin` syncs the configured Hyacinth department into the `employees` collection and preserves the full source profile plus registration status.

Deploy the rules with `firebase deploy --only firestore:rules` after authenticating with the Firebase CLI. Create the admin custom claim with a trusted Firebase Admin SDK environment, never from the browser.

The generated temporary password is currently stored in the employee document to satisfy credential retrieval and PDF download. Treat that field as sensitive and replace it with a one-time server-side credential handoff before production use.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
