import React, {useEffect} from 'react';
import ReactDOM from 'react-dom/client';
import {
  Route,
  BrowserRouter as Router,
  Routes,
  useLocation,
} from 'react-router';
import Company from './Company';
import {features} from './featureFlags';
import Footer from './Footer';
import Header from './Header';
import FullScreenMap from './Map';
import NotFound from './NotFound';
import Search from './Search';
import Skyline from './Skyline';
import Checkout from './store/Checkout';
import {HatPreviewProvider} from './store/PreparedHatPreview';
import Receipt from './store/Receipt';
import Store from './store/Store';
import {prefetchStorefront} from './store/storefrontCache';
import FlexContainerColumn from './styled-components/FlexContainerColumn';
import FlexContainerRow from './styled-components/FlexContainerRow';
import FlexFullHeightMin from './styled-components/FlexFullHeightMin';
import FlexMain from './styled-components/FlexMain';
import GlobalStyle from './styled-components/GlobalStyle';

function StorePrefetch() {
  const {pathname} = useLocation();

  useEffect(() => {
    if (
      !features.store ||
      pathname === '/store' ||
      pathname.startsWith('/store/')
    ) {
      return;
    }
    // Keep the inventory warm while visitors browse other pages.
    void prefetchStorefront().catch(() => {});
  }, [pathname]);

  return null;
}

function AppRouter() {
  return (
    <Router>
      <GlobalStyle />
      <StorePrefetch />
      <FullScreenMap />
      <FlexContainerRow>
        <FlexFullHeightMin>
          <FlexContainerColumn>
            <Header />
            <FlexMain>
              <FlexContainerColumn>
                <HatPreviewProvider>
                  <Routes>
                    <Route path="/" element={<Skyline />} />
                    <Route path="/company" element={<Company />} />
                    {features.search ? (
                      <Route path="/search" element={<Search />} />
                    ) : null}
                    {features.store ? (
                      <>
                        <Route path="/store" element={<Store />} />
                        <Route path="/store/checkout" element={<Checkout />} />
                        <Route path="/store/receipt" element={<Receipt />} />
                      </>
                    ) : null}
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </HatPreviewProvider>
              </FlexContainerColumn>
            </FlexMain>
            <Footer />
          </FlexContainerColumn>
        </FlexFullHeightMin>
      </FlexContainerRow>
    </Router>
  );
}

const rootElement = document.getElementById('©');
if (!rootElement) throw new Error('Failed to find the root element');
const root = ReactDOM.createRoot(rootElement);
root.render(<AppRouter />);
