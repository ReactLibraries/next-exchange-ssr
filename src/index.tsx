import { DocumentNode } from "graphql";
import React from "react";
import { ReactNode, useRef } from "react";
import {
  AnyVariables,
  Client,
  composeExchanges,
  Exchange,
  makeResult,
  OperationResult,
  ssrExchange,
  TypedDocumentNode,
  useClient,
} from "urql";

import { pipe, tap, filter, merge, mergeMap, fromPromise } from "wonka";

type Promises = Set<Promise<void>>;
const DATA_NAME = "__NEXT_DATA_PROMISE__";
const isServerSide = typeof window === "undefined";

/**
 * Collecting data from HTML
 */
export const getInitialState = () => {
  if (typeof window !== "undefined") {
    const node = document.getElementById(DATA_NAME);
    if (node) return JSON.parse(node.innerHTML);
  }
  return undefined;
};

/**
 * Wait until end of Query and output collected data at render time
 */
const DataRender = ({ client: c }: { client?: Client }) => {
  const client = c ?? useClient();
  if (isServerSide) {
    const extractData = client.readQuery(`query{extractData}`, {})?.data
      .extractData;
    if (!extractData) {
      throw client.query(`query{extractData}`, {}).toPromise();
    }
    return (
      <script
        id={DATA_NAME}
        type="application/json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(extractData).replace(/</g, "\\u003c"),
        }}
      />
    );
  }
  return null;
};

/**
 * For SSR data insertion
 */
export const NextSSRProvider = ({
  client,
  children,
}: {
  client?: Client;
  children: ReactNode;
}) => {
  return (
    <>
      {children}
      <DataRender client={client} />
    </>
  );
};

/**
 * Get name from first field
 */
const getFieldSelectionName = (
  query: DocumentNode | TypedDocumentNode<any, AnyVariables>
) => {
  const definition = query.definitions[0];
  if (definition?.kind === "OperationDefinition") {
    const selection = definition.selectionSet.selections[0];
    if (selection?.kind === "Field") {
      return selection.name.value;
    }
  }
  return undefined;
};

/**
 * local query function
 */
const createLocalValueExchange = <T extends object>(
  key: string,
  callback: () => Promise<T>
) => {
  const localValueExchange: Exchange = ({ forward }) => {
    return (ops$) => {
      const filterOps$ = pipe(
        ops$,
        filter(({ query }) => {
          const selectionName = getFieldSelectionName(query);
          return key !== selectionName;
        }),
        forward
      );
      const valueOps$ = pipe(
        ops$,
        filter(({ query }) => {
          const selectionName = getFieldSelectionName(query);
          return key === selectionName;
        }),
        mergeMap((op) => {
          return fromPromise(
            new Promise<OperationResult>(async (resolve) => {
              resolve(makeResult(op, { data: { [key]: await callback() } }));
            })
          );
        })
      );
      return merge([filterOps$, valueOps$]);
    };
  };
  return localValueExchange;
};

/**
 * Query standby extensions
 */
export const createNextSSRExchange = () => {
  const promises: Promises = new Set();

  const _ssrExchange = ssrExchange({
    isClient: !isServerSide,
    // Set up initial data required for SSR
    initialState: getInitialState(),
  });
  const _nextExchange: Exchange = ({ forward }) => {
    return (ops$) => {
      if (!isServerSide) {
        return forward(ops$);
      } else {
        return pipe(
          ops$,
          tap(({ kind, context }) => {
            if (kind === "query") {
              const promise = new Promise<void>((resolve) => {
                context.resolve = resolve;
              });
              promises.add(promise);
              promise.then(() => {
                promises.delete(promise);
              });
            }
          }),
          forward,
          tap(({ operation }) => {
            if (operation.kind === "query") {
              operation.context.resolve();
            }
          })
        );
      }
    };
  };
  return composeExchanges(
    [
      _ssrExchange,
      isServerSide &&
        createLocalValueExchange("extractData", async () => {
          while (promises.size) {
            await Promise.allSettled(promises);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          return _ssrExchange.extractData();
        }),
      _nextExchange,
    ].filter((v): v is Exchange => v !== false)
  );
};

/**
 * Get exchange for Next.js
 */
export const useCreateNextSSRExchange = () => {
  const refExchange = useRef<Exchange>();
  if (!refExchange.current) {
    refExchange.current = createNextSSRExchange();
  }
  return refExchange.current;
};
