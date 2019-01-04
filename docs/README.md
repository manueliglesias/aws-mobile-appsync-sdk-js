# Overview

This repository is a [mono-repo](https://en.wikipedia.org/wiki/Monorepo) for, at the moment, the following npm packages:

package | version
--- | ---
aws-appsync | ![npm](https://img.shields.io/npm/v/aws-appsync.svg)
aws-appsync-react | ![npm](https://img.shields.io/npm/v/aws-appsync-react.svg)

![Overview](./media/Overview.png)

## `aws-appsync`
This is the main package. It enables you to access your [AWS AppSync](https://aws.amazon.com/appsync/) backend and perform [GraphQL](https://graphql.org/learn/) operations like Queries, Mutations, and Subscriptions. The SDK also includes support for offline operations. This SDK is built as an extension of the [`apollo-client`](https://github.com/apollographql/apollo-client) package. (You can use most of the tools available for `apollo-client`, like [`apollo-client-devtools`](https://github.com/apollographql/apollo-client-devtools), [custom links](https://github.com/apollographql/apollo-link), the [React integration for Apollo Client](https://github.com/apollographql/react-apollo), etc.)

This SDK can be used in the Web Browser, React Native, Node.js and even inside Lambda functions with the Node.js runtime.

### Features
- Offline support
    - Helpers
- Complex objects
- Delta sync
- Real time (subscriptions)
- Local conflict resolution

### Dependencies
- `apollo-client`
- `redux-offline`

### AppSync link
![Link](./media/AppSyncLink.png)

## `aws-appsync-react`

### Dependencies
- `react-apollo`
- `aws-appsync`