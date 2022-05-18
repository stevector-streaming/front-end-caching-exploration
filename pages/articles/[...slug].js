import Image from "next/image";
import Link from "next/link";
import { NextSeo } from "next-seo";
import {
  DrupalState,
  fetchJsonapiEndpoint,
} from "@pantheon-systems/drupal-kit";
import { isMultiLanguage } from "../../lib/isMultiLanguage";
import Layout from "../../components/layout";
import { DRUPAL_URL, IMAGE_URL } from "../../lib/constants.js";

export default function Home({ article, hrefLang }) {
  const imgSrc = article.field_media_image?.field_media_image?.uri?.url || "";
  return (
    <Layout>
      <NextSeo
        title="Decoupled Next Drupal Demo"
        description="Generated by create next app."
        languageAlternates={hrefLang}
      />
      <article className="prose lg:prose-xl mt-10 mx-auto">
        <h1>{article.title}</h1>

        <Link passHref href="/">
          <a className="font-nomral">Home &rarr;</a>
        </Link>

        <div className="mt-12 max-w-lg mx-auto lg:grid-cols-3 lg:max-w-screen-lg">
          {imgSrc ? (
            <div
              className="relative w-full rounded-lg shadow-lg overflow-hidden mb-10"
              style={{ height: "50vh" }}
            >
              <Image
                priority
                src={IMAGE_URL + imgSrc}
                layout="fill"
                objectFit="cover"
                alt={article.title}
              />
            </div>
          ) : null}
          <div dangerouslySetInnerHTML={{ __html: article.body.value }} />
        </div>
      </article>
    </Layout>
  );
}

export async function getServerSidePaths(context) {
  const multiLanguage = isMultiLanguage(context.locales);
  // TODO - locale increases the complexity enough here that creating a usePaths
  // hook would be a good idea.
  // Get paths for each locale.
  const pathsByLocale = context.locales.map(async (locale) => {
    const store = new DrupalState({
      apiBase: DRUPAL_URL,
      defaultLocale: multiLanguage ? locale : "",
      clientId: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
    });

    const articles = await store.getObject({
      objectName: "node--article",
      query: `
          {
            id
            path {
              alias
            }
          }
        `,
    });
    return articles.map((article) => {
      // matches everything after /articles/
      const match = article.path.alias.match(/^\/articles\/(.*)$/);
      const slug = match[1];

      return { params: { slug: [slug] }, locale: locale };
    });
  });

  // Resolve all promises returned as part of pathsByLocale.
  const paths = await Promise.all(pathsByLocale).then((values) => {
    // Flatten the array of arrays into a single array.
    return [].concat(...values);
  });

  return {
    paths,
    fallback: false,
  };
}

export async function getServerSideProps(context) {
  const multiLanguage = isMultiLanguage(context.locales);
  // TODO - determine apiBase from environment variables
  const store = new DrupalState({
    apiBase: DRUPAL_URL,
    defaultLocale: multiLanguage ? context.locale : "",
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
  });

  const slug = `/articles/${context.params.slug[0]}`;

  // if preview, use preview endpoint and add to store.
  if (context?.previewData?.key) {
    let requestInit = {};
    if (process.env.CLIENT_ID && process.env.CLIENT_SECRET) {
      requestInit = {
        headers: {
          Authorization: await store.getAuthHeader(),
        },
      };
    }

    const previewData = await fetchJsonapiEndpoint(
      `${store.apiRoot}decoupled-preview/${context.previewData.key}?include=field_media_image.field_media_image`,
      requestInit
    );
    const uuid = previewData.data.id;

    store.setState({ "node--articleResources": { [uuid]: previewData } });
  }

  // if a revision, pass resourceVersion parameter.
  if (context?.previewData?.resourceVersionId) {
    store.params.addCustomParam({
      resourceVersion: `id:${context.previewData.resourceVersionId}`,
    });
  }

  // If preview mode, get the preview data from the store, other wise fetch from the api.
  store.params.addInclude(["field_media_image.field_media_image"]);
  const article = await store.getObjectByPath({
    objectName: "node--article",
    // Prefix the slug with the current locale
    path: `${multiLanguage ? context.locale : ""}${slug}`,
    query: `
        {
          id
          title
          body
          path {
            alias
          }
          field_media_image {
            field_media_image {
              uri {
                url
              }
            }
          }
        }
      `,
  });

  const origin = process.env.NEXT_PUBLIC_FRONTEND_URL;
  const { locales } = context;
  // Load all the paths for the current article.
  const paths = locales.map(async (locale) => {
    const storeByLocales = new DrupalState({
      apiBase: DRUPAL_URL,
      defaultLocale: multiLanguage ? locale : "",
      clientId: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
    });
    const { path } = await storeByLocales.getObject({
      objectName: "node--article",
      id: article.id,
    });
    return path;
  });

  // Resolve all promises returned as part of paths
  // and prepare hrefLang.
  const hrefLang = await Promise.all(paths).then((values) => {
    return values.map((value) => {
      return {
        hrefLang: value.langcode,
        href: origin + "/" + value.langcode + value.alias,
      };
    });
  });

  context.res.setHeader(
    'Cache-Control',
    'public, s-maxage=10, stale-while-revalidate=6000'
  );

  return {
    props: {
      article,
      hrefLang,
      revalidate: 60,
    },
  };
}
