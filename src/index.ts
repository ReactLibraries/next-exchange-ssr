import { DocumentNode } from "graphql";
import { createElement, Fragment, ReactNode } from "react";
import {
  AnyVariables,
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
const DataRender = () => {
  const client = useClient();
  if (isServerSide) {
    const extractData = client.readQuery(`query{extractData}`, {})?.data
      .extractData;
    if (!extractData) {
      throw client.query(`query{extractData}`, {}).toPromise();
    }
    return createElement("script", {
      id: DATA_NAME,
      type: "application/json",
      dangerouslySetInnerHTML: {
        __html: JSON.stringify(extractData).replace(/</g, "\\u003c"),
      },
    });
  }
  return null;
};

/**
 * For SSR data insertion
 */
export const NextSSRProvider = ({ children }: { children: ReactNode }) => {
  return createElement(Fragment, {}, children, createElement(DataRender));
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
          let length: number;
          while ((length = promises?.size)) {
            await Promise.allSettled(promises).then(() => {
              if (length === promises.size) {
                promises.clear();
              }
            });
          }
          return _ssrExchange.extractData();
        }),
      _nextExchange,
    ].filter((v): v is Exchange => v !== false)
  );
};
