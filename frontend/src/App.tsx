import { useState } from 'react';
import PinGate from './components/PinGate';
import MapView from './components/MapView';
import StatsBar from './components/StatsBar';
import SearchBar from './components/SearchBar';
import Sidebar from './components/Sidebar';
import DetailPanel from './components/DetailPanel';
import { useBuildings } from './hooks/useBuildings';
import { emptyFilters } from './lib/types';
import type { Building, FilterState, ColorMode } from './lib/types';

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [hoveredBuilding, setHoveredBuilding] = useState<Building | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('contact');
  const [filters, setFilters] = useState<FilterState>(emptyFilters());
  const [showAllArcs, setShowAllArcs] = useState(false);
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number; zoom: number } | null>(null);

  const { buildings, filtered, loading } = useBuildings(filters);

  if (!authenticated) {
    return <PinGate onSuccess={() => setAuthenticated(true)} />;
  }

  function handleSelectBuilding(b: Building) {
    setSelectedBuilding(b);
    setFlyTo({ lng: b.lng, lat: b.lat, zoom: 16 });
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-100">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-700 z-20 shrink-0">
        <div className="font-semibold text-white text-sm mr-4 whitespace-nowrap">MKW Buildings</div>
        <div className="flex-1 max-w-md">
          <SearchBar onSelectBuilding={handleSelectBuilding} />
        </div>
        <div className="flex-1" />
        <StatsBar buildings={buildings} filtered={filtered} />
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <Sidebar
          buildings={buildings}
          filtered={filtered}
          filters={filters}
          onFiltersChange={setFilters}
          colorMode={colorMode}
          onColorModeChange={setColorMode}
          showAllArcs={showAllArcs}
          onShowAllArcsChange={setShowAllArcs}
        />

        {/* Map */}
        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 z-10">
              <div className="text-white text-sm bg-gray-900 px-4 py-2 rounded-lg">
                Loading buildings…
              </div>
            </div>
          )}
          <MapView
            buildings={filtered}
            allBuildings={buildings}
            selectedBuilding={selectedBuilding}
            hoveredBuilding={hoveredBuilding}
            colorMode={colorMode}
            showAllArcs={showAllArcs}
            flyTo={flyTo}
            onFlyToComplete={() => setFlyTo(null)}
            onBuildingClick={setSelectedBuilding}
            onBuildingHover={setHoveredBuilding}
          />
        </div>

        {/* Right detail panel */}
        {selectedBuilding && (
          <DetailPanel
            building={selectedBuilding}
            onClose={() => setSelectedBuilding(null)}
            onOwnerClick={(ownerId) => {
              setFilters(f => ({ ...f, ownerId }));
              setSelectedBuilding(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
