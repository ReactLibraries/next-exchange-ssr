# @react-libraries/next-exchange-ssr

SSR with urql and Next.js for `Exchange`

## Sample

- Source
  <https://github.com/ReactLibraries/next-exchange-ssr>
- App
  <https://github.com/SoraKumo001/next-urql>

### src/pages/\_app.tsx

```ts
import { useMemo, useState } from "react";
import { cacheExchange, Client, fetchExchange, Provider } from "urql";
import {
  createNextSSRExchange,
  NextSSRProvider,
} from "@react-libraries/next-exchange-ssr";
import type { AppType } from "next/app";

const isServerSide = typeof window === "undefined";
const endpoint = "/api/graphql";
const url = isServerSide
  ? `${
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000"
    }${endpoint}`
  : endpoint;

const App: AppType = ({ Component, pageProps }) => {
  // NextSSRExchange to be unique on AppTree
  const [nextSSRExchange] = useState(createNextSSRExchange);
  const client = useMemo(() => {
    return new Client({
      url,
      // Only on the Server side do 'throw promise'.
      suspense: isServerSide,
      exchanges: [cacheExchange, nextSSRExchange, fetchExchange],
    });
  }, [nextSSRExchange]);

  return (
    <Provider value={client}>
      {/* Additional data collection functions for SSR */}
      <NextSSRProvider>
        <Component {...pageProps} />
      </NextSSRProvider>
    </Provider>
  );
};

// Create getInitialProps that do nothing to prevent Next.js optimisation.
App.getInitialProps = () => ({});

export default App;
```

### src/pages/index.tsx

```tsx
import { gql, useMutation, useQuery } from "urql";

// Date retrieval
const QUERY = gql`
  query date {
    date
  }
`;

// Uploading files
const UPLOAD = gql`
  mutation Upload($file: Upload!) {
    upload(file: $file) {
      name
      type
      value
    }
  }
`;

const Page = () => {
  const [{ data }, refetch] = useQuery({ query: QUERY });
  const [{ data: file }, upload] = useMutation(UPLOAD);

  return (
    <>
      <a
        target="_blank"
        href="https://github.com/SoraKumo001/next-apollo-server"
        rel="noreferrer"
      >
        Source code
      </a>
      <hr />
      {/* SSRedacted data can be updated by refetch. */}
      <button onClick={() => refetch({ requestPolicy: "network-only" })}>
        Update date
      </button> {/* Dates are output as SSR. */}
      {data?.date &&
        new Date(data.date).toLocaleString("en-US", { timeZone: "UTC" })}
      {/* File upload sample from here down. */}
      <div
        style={{
          height: "100px",
          width: "100px",
          background: "lightgray",
          marginTop: "8px",
          padding: "8px",
        }}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          const file = e.dataTransfer.files[0];
          if (file) {
            upload({ file });
          }
          e.preventDefault();
        }}
      >
        Upload Area
      </div>
      {/* Display of information on returned file data to check upload operation. */}
      {file && <pre>{JSON.stringify(file, undefined, "  ")}</pre>}
    </>
  );
};

export default Page;
```
